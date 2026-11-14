'use strict';
// Bench transport only: these synthetic values are never shipped in the car source package.
const IF = {
    cds: 'de.bmw.infotainment.vehicle.CDS', speed: 'de.bmw.infotainment.vehicle.Vehicle2',
    gear: 'de.bmw.infrastructure.VehicleInformation', condition: 'de.bmw.infrastructure.VehicleCondition',
    fuel: 'de.bmw.infotainment.KombiIF', fes: 'de.bmw.infotainment.drivingexcitement.FES',
    acceleration: 'de.bmw.infotainment.vehicle.CDS2', ambient: 'de.bmw.infrastructure.EnvironmentalInformation',
    units: 'de.bmw.infotainment.vehicle.Vehicle', program: 'de.bmw.infotainment.misc.MDrive',
    tyres: 'de.bmw.infotainment.vehicle.TPMS',
};
const GROUPS = {
    cds: ['rpm', 'oil', 'coolant', 'engineRunning'], speed: ['speed'], gear: ['gear', 'selector'],
    condition: ['condition'], fuel: ['fuelL', 'range', 'odometer', 'avgConsumption', 'tripDistance', 'tripMinutes'],
    fes: ['driveModeRaw', 'boost', 'torque', 'power'], acceleration: ['gLong', 'gLat'],
    ambient: ['ambient'], units: ['pFL', 'pFR', 'pRL', 'pRR', 'tFL', 'tFR', 'tRL', 'tRR'],
    program: ['gearboxProgram'], tyres: ['pFL', 'pFR', 'pRL', 'pRR', 'tFL', 'tFR', 'tRL', 'tRR'],
    engineProfile: ['engineProfile'], dsc: ['dsc'], consumption: ['consumption', 'fuelFlow', 'tripFuel'], intake: ['intake'],
};
const finite = v => typeof v === 'number' && isFinite(v);
const encoded = (value, factor, offset, invalid) => finite(value) ? Math.round((value - offset) / factor) : invalid;

function adapter(hu, notifications) {
    const disabled = {}, available = {};
    function availability(iface, on) {
        (hu.subs[iface] || []).forEach(s => { s.res.available = on; });
        if (available[iface] === on) return;
        available[iface] = on;
        (notifications[iface] || []).slice().forEach(fn => fn(on));
    }
    function source(group, on) {
        if (!Object.prototype.hasOwnProperty.call(GROUPS, group)) return;
        disabled[group] = !on;
        if (IF[group]) availability(IF[group], !!on);
    }
    function missing() { Object.keys(hu.subs).forEach(iface => availability(iface, false)); }
    function feed(group, field, value) {
        if (disabled[group]) return;
        availability(IF[group], true);
        hu.feed(IF[group], field, value);
    }
    function values(manual, mode) {
        const out = Object.assign({}, manual);
        if (mode !== 'manual') {
            Object.keys(out).forEach(k => { if (k !== 'simulateCarSafety' && k !== 'forceProfile') out[k] = null; });
        }
        Object.keys(disabled).forEach(group => { if (disabled[group]) GROUPS[group].forEach(k => { out[k] = null; }); });
        if (disabled.condition || (manual.condition !== undefined && manual.condition !== 7 && manual.condition !== 10 && manual.condition !== 'FAHREN' && manual.condition !== 'PRUEFEN_ANALYSE_DIAGNOSE')) {
            Object.keys(out).forEach(k => { if (k !== 'simulateCarSafety' && k !== 'forceProfile' && k !== 'condition') out[k] = null; });
        }
        return out;
    }
    function tick(v, drive) {
        // Vehicle lifecycle first: wake-up must precede the fresh numeric observations.
        feed('condition', 'VehicleCondition', { statusConditionVehicle: v.condition === undefined ? 255 : v.condition });
        feed('cds', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: encoded(v.rpm, 0.25, 0, 65535) });
        feed('cds', 'statusEngineTemperature', { temperatureEngineDrive: encoded(v.coolant, 1, -48, 255), temperatureEngineOilDrive: encoded(v.oil, 1, -48, 255) });
        feed('cds', 'statusEngineStatus', { statusEngineRunDrive: v.engineRunning === true ? 'MOTOR_LAEUFT' : v.engineRunning === false ? 'MOTOR_AUS' : 3 });
        feed('speed', 'statusCarSpeed2', { speedVehicleCentreOfGravity: encoded(v.speed, 0.015625, 0, 65535) });
        feed('acceleration', 'statusLongitudinalAccelerationMassCenter', { longitudinalAccelerationCentreOfGravity: encoded(finite(v.gLong) ? v.gLong * 9.80665 : null, 0.002, -65, 65535) });
        feed('acceleration', 'statusLateralAccelerationMassCenter', { lateralAccelerationCentreOfGravity: encoded(finite(v.gLat) ? v.gLat * 9.80665 : null, 0.002, -65, 65535) });
        const selector = Object.prototype.hasOwnProperty.call(v, 'selector') ? v.selector : finite(v.gear) && v.gear > 0 ? 'D' : 'P'; // Legacy fixture only.
        const actualGear = finite(v.gear) && v.gear > 0 ? 'G' + v.gear : selector === 'R' ? 'R' : ['P', 'N'].indexOf(selector) >= 0 ? 'N_OR_P' : 255;
        feed('gear', 'statusGearboxDrive', { statusActualGearDrive: actualGear, statusActualStageDrive: selector || 255 });
        feed('fes', 'statusFESVehicleDynamicSwitchHMI', { actualValueModeDrivingExperience: drive === null || drive === undefined ? (v.driveModeRaw === undefined || v.driveModeRaw === null ? 255 : v.driveModeRaw) : drive });
        feed('fes', 'statusActualValueTorque2', { actualValueTorqueCrankshaft: encoded(v.torque, 0.5, -1023.5, 4095) });
        feed('fes', 'statusSwitchDriveDynamicSport2', { displayBoostPressure: encoded(v.boost, 0.01, 0, 255) });
        feed('fuel', 'statusRangeTankStatus', { fluidLevelFuelTank: encoded(v.fuelL, 1, 0, 255), range: encoded(v.range, 1, 0, 4095), mileageKilometre: encoded(v.odometer, 1, 0, 16777215) });
        feed('fuel', 'statusBordcomputerAverage', { consumptionAverage1BC1: encoded(v.avgConsumption, 0.1, 0, 65535), consumptionAverage2BC2: 65535, statusUnitOfMeasurementConsumptionBC: 1 });
        feed('fuel', 'statusBordcomputerTravelData', { wayPassed: encoded(v.tripDistance, 1, 0, 65535), rideDurationHours: finite(v.tripMinutes) ? Math.floor(v.tripMinutes / 60) : 65535, rideDurationMinutes: finite(v.tripMinutes) ? Math.floor(v.tripMinutes % 60) : 65535 });
        feed('ambient', 'ExteriorTemperature', { temperatureExterior: encoded(v.ambient, 0.5, -40, 255) });
        feed('units', 'statusNewCurrentUnitsStatusExt', { unitOfMeasurementAirPressure: 1, unitOfMeasurementTemperature: 1 });
        feed('program', 'dataDisplayGearbox', { displayProgramGearbox: v.gearboxProgram === 'S' ? 'S_MINUS_PROGRAMM' : v.gearboxProgram === 'M' ? 'M_MINUS_PROGRAMM' : v.gearboxProgram === 'D' ? 'D_PROGRAMM' : 255 });
        const pressures = {}, temperatures = {};
        ['FL', 'FR', 'RL', 'RR'].forEach(corner => {
            pressures['actualValuePressureTyre' + corner + 'H'] = encoded(v['p' + corner], 0.1, 0, 65535);
            temperatures['actualValueTemperatureTyre' + corner + 'H'] = encoded(v['t' + corner], 1, -40, 65535);
        });
        feed('tyres', 'statusTyrePressure', pressures);
        feed('tyres', 'statusTyreTemperature', temperatures);
    }
    return { source, missing, tick, values };
}
module.exports = { adapter, IF, GROUPS };
