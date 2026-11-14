# Карта источников данных

Аудит выполнен 14 ноября 2026 **до реализации трёх профилей**. Первоначально данных с BMW G30 не было. Обновление 0.3.4: владелец предоставил фотографии реального диагностического списка и подтвердил метрический средний расход по штатному экрану; прямое подключение разработчика не выполнялось. Наличие поля в исходниках, манифесте или локальном каталоге не доказывает его доступность либо правильную семантику на G30. Итог локальных проверок реализации фиксируется отдельно в `VERIFICATION.md`.

## Версии и охват

`git rev-parse HEAD` локальных исходников совпал с `UPSTREAM.lock.json`:

| Репозиторий | Commit |
|---|---|
| bimmer-lab/apps | `aaa43e49500ccb4cd6b07537644ac072db49eb99` |
| cauliflowermossgrape/idrive7-apps | `9f0f68afe8407e80c411d9be92519528c3f6f023` |
| robertnisipeanu/idrive-apps | `f7a678b27693c88a12d2ed4f18ac4652f005bffd` |
| robertnisipeanu/mgu-store | `9c2360a211cfe75fbe4c2b2db86f84a33b380fb9` |

В bimmer-apps проверены оба приложения (`cluster_themes`, `idrive_hud_widgets`), shared HUD/данные/темы/слоты, runtime, сборщик и bench. В idrive7-apps выполнен поиск по всем 15 приложениям; относящиеся к задаче реализации находятся в `car_vitals`, `redline`, `live_data`, `gforce`, `warmup`, `dyno`, `draggy`, `edrive`, `zf8hp` и `ambient_config`. Код `live_adjustments` проверялся для отделения чтения от управления; его управляющие процедуры не переносятся. `service`, `dtc_scanner`, `brake_test`, `doom` не дают дополнительной подтверждённой семантики требуемых состояний. Robert idrive-apps и MGU Store служат первичными источниками протокола renderer и упаковки, не подтверждением наличия сигналов конкретного автомобиля.

Основные ссылки на неизменяемый исходный код:

- [bimmer shared/hud.js](https://github.com/bimmer-lab/apps/blob/aaa43e49500ccb4cd6b07537644ac072db49eb99/shared/hud.js): `driveModeOf`, `driveVariantOf`, `SETUP`, `_setupVehicleData`, `_raw`, `_boost`, `_startDme`; строки 323–395, 650–745, 845–905, 1306–1340.
- [bimmer kit/runtime/car.js](https://github.com/bimmer-lab/apps/blob/aaa43e49500ccb4cd6b07537644ac072db49eb99/kit/runtime/car.js): `gearOf`, `selectionOf`, таблицы масштабирования, подписки в `Car`.
- [Live Data signals.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/9f0f68afe8407e80c411d9be92519528c3f6f023/apps/live_data/signals.js): `GROUPS`, `value`, `sourcesOf`, `Flow`; наиболее полная карта сигналов. Поле `q:true` у автора означает **предположительный масштаб**, `raw:true` — отсутствие расшифровки.
- [Car Vitals main.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/9f0f68afe8407e80c411d9be92519528c3f6f023/apps/car_vitals/main.js): `gearOf`, `modeOf`, `tyreP`, `tyreT`, массив `watches`.
- [Redline tyres.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/9f0f68afe8407e80c411d9be92519528c3f6f023/apps/redline/tyres.js): `Tyres.handlers`, `pressure`, `temperature`, `value`; единицы TPMS и срок хранения.
- [Ambient config ambient.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/9f0f68afe8407e80c411d9be92519528c3f6f023/apps/ambient_config/ambient.js): `BY_NAME`, `BY_NUMBER`, `modeOf`; для нас полезна только точная таблица режима, не методы записи подсветки.

## Уровни доказательности

1. **Упоминание** — имя без работающего читателя либо без расшифровки.
2. **Реализация в исходниках** — есть обработчик и преобразование; может иметь собственную отметку автора о неопределённости.
3. **Локальный стенд** — проверены наш обработчик и графика на явно искусственных входных данных. Это не проверка SOME/IP автомобиля.
4. **Реальные данные G30 пользователя** — нужны фактический ответ, жизненный цикл и сверка показания. Сейчас таких подтверждений **нет**.
5. **Недоступно / не расшифровано** — нет обоснованной нормализации; на приборке прочерк, raw допускается лишь в диагностическом отчёте.

## Общие правила актуальности

Сигналы — SOME/IP. `kit/runtime/signals.js::watch(iface,'1',handlers,log,opts)` создаёт подписки, получает availability и делает начальное `getValue` только если сгенерированная схема содержит getter. Значение `s` в манифесте означает только подписку, `rs` — чтение/подписку; прав записи у приложения нет. Наличие proxy или файла схемы не равно наличию пригодного ответа.

Для всех следующих строк действуют обязательные правила: при availability=false очистить показатели этого источника; при сне/неактивном VehicleCondition очистить текущие состояния и сменить поколение данных; поздние ответы старого поколения игнорировать; после пробуждения нужны новые события или успешные чтения. Передача, режим и DSC не восстанавливаются из вчерашних настроек.

- **Быстрые численные данные:** скорость/RPM подтверждать новыми событиями или успешными штатными getters при активном автомобиле. Для момента/G и других динамических показателей нужен отдельный срок актуальности; старое значение не считать текущим.
- **Событийные состояния:** режим/селектор/программа могут не меняться долго. Не обнулять их произвольным общим таймером, пока действует тот же период доступности источника и активного автомобиля. Потеря источника или сон инвалидируют их немедленно.
- **Медленные численные данные:** температура, топливо, BC, TPMS имеют отдельные ограничения и, где есть getters, редкое чтение только в активном состоянии. Отсутствие уведомления на стоянке само по себе не означает отказ. Нельзя сохранять их бессрочно через потерю provider или сон.
- Частота автомобиля не установлена по исходникам. Указанный интервал локального опроса — решение приложения, не обещание частоты шины. Не использовать диагностический keepalive, запуск provider, запись или постоянный поиск ECU.

## Независимые состояния автомобиля

| Показатель | Где реализован | Точный источник и нормализация | Актуальность и уровень |
|---|---|---|---|
| Общий режим движения | bimmer `shared/hud.js::driveModeOf/driveVariantOf`; idrive7 `live_data/signals.js::GROUPS`, `ambient_config/ambient.js::BY_NAME/BY_NUMBER` | `de.bmw.infotainment.drivingexcitement.FES.statusFESVehicleDynamicSwitchHMI.actualValueModeDrivingExperience`. Таблица ниже. Прямое enum-состояние; неизвестный код не превращается в Comfort. | Событийный; начальный getter если доступен; реализация в исходниках, G30 не проверена. |
| Двигатель работает / выключен | idrive7 `live_data/signals.js` Engine / `running` | `de.bmw.infotainment.vehicle.CDS.statusEngineStatus.statusEngineRunDrive`: `MOTOR_AUS/0`, `MOTOR_STARTET/1`, `MOTOR_LAEUFT/2`; `3` и неизвестное недоступны. | Событийный; **не профиль двигателя**. Реализация в исходниках. |
| Отдельный профиль двигателя | bimmer `shared/hud.js::SETUP`, `_setup` | `SETUP` вычисляется из общего режима. Комментарий автора прямо говорит: значения составных частей Individual не найдены. Отдельный достоверный источник не найден. | Недоступно: `ENGINE: —`. Даже в Sport или Comfort не подставлять общий режим. |
| Положение селектора | bimmer `kit/runtime/car.js`; idrive7 `live_data/signals.js::gearbox`; текущий `retro_source.js::receive` | `de.bmw.infrastructure.VehicleInformation.statusGearboxDrive.statusActualStageDrive`: `P/1`, `R/2`, `N/3`, `D/4`. | Событийный; обычно без getter. Прямое положение, не программа D/S/M. Реализация в исходниках и предыдущие локальные тесты. |
| Фактическая передача | те же функции | `statusGearboxDrive.statusActualGearDrive`: `R/1 → -1`, `N_OR_P/2 → 0`, `G1…G10/3…12 → 1…10`. Только целые числа; N_OR_P не различает P и N. | Как селектор; не угадывать из RPM/скорости. |
| Резервный селектор/передача | idrive7 `live_data/signals.js::selection`, bimmer `kit/runtime/car.js::selectionOf` | `VehicleInformation.DataPowerTrain2.statusGearSelectionDrive`: `N/1`, `R/2`, `P/3`, `NP/4` неоднозначно, `_1…_9/5…13` фактическая передача 1…9. | Отдельное событийное поле, известный рабочий обход на чужом автомобиле, не доказательство для G30. |
| Программа коробки S/M | idrive7 `car_vitals/main.js::PROGRAMS`, bimmer `shared/hud.js::PROGRAMS` | `de.bmw.infotainment.misc.MDrive.dataDisplayGearbox.displayProgramGearbox`: `S_MINUS_PROGRAMM/1 → S`, `M_MINUS_PROGRAMM/2 → M`. | Событийный; MDrive может отсутствовать на 540i. Независимо от FES. |
| Программа D и Individual коробки | bimmer `gradeMode`, `kit/runtime/car.js::programOf` и Car Vitals `modeOf` | bimmer принимает `0` или имя с префиксом D для оценки переключений; `modeOf/programOf` сканируют произвольные поля регулярными выражениями, `programOf` по умолчанию возвращает D. Это предположение, не отдельный прямой сигнал; настройка Individual не найдена. | Не переносить regex-эвристику и резервное D как подтверждённое чтение. Положение D можно подписывать именно как положение, не выдавать его за подтверждение программы D. |
| DSC/ASC/ABS | idrive7 `live_data/signals.js::GROUPS`, Chassis raw | `de.bmw.chassis.VehicleStabilizationManagement.StabilizationManagement.qualifierFunctionFDR`, `qualifierFunctionASC`, `qualifierFunctionABS`. Все три объявлены `raw:true,x:true`. Таблица ON/DTC/OFF/intervention/fault не найдена. | Не расшифровано. Все реальные коды пока `DSC: —`; raw только в отчёте. Ноль не означает ON. |
| Жизненный цикл | bimmer `shared/vehicle_state.js`, текущий `retro_source.js` | `de.bmw.infrastructure.VehicleCondition.VehicleCondition.statusConditionVehicle`; 7=диагностика/проверка,10=готовность движения разрешены текущей защитой; прочие и неизвестное освобождают отображение. | Событийный. Ни этот сигнал, ни RPM сами по себе не раскрывают engine profile. |

Точная таблица FES, найденная в `ambient_config/ambient.js::BY_NAME` (34–42) и `live_data/signals.js` (110):

| Код | Имя | Подпись | Визуальная группа |
|---|---|---|---|
| 1 | SPORT_DYNAMIC | SPORT | Sport |
| 2 | SPORT_EXPERT | SPORT+ | Sport |
| 3 | SPORT_INDIVIDUAL | SPORT INDIVIDUAL | Sport |
| 4 | COMFORT | COMFORT | Comfort |
| 5 | COMFORT_PLUS | COMFORT+ | Comfort |
| 6 | COMFORT_INDIVIDUAL | COMFORT INDIVIDUAL | Comfort |
| 7 | ECO_PRO_EFFICIENT | ECO PRO | Eco |
| 8 | ECO_PRO_PLUS | ECO PRO+ | Eco |
| 9 | ECO_PRO_INDIVIDUAL | ECO PRO INDIVIDUAL | Eco |
| 10 | ADAPTIVE | ADAPTIVE | Резервное содержимое, без отдельного дизайна |

`0`, `61–63`, неполные/неизвестные строки и коды остаются неизвестными. PHEV-коды 15–23/28 найдены в Ambient Config, но не являются основанием расширять профиль 540i. Неподтверждённые варианты не распознавать только по наличию слова SPORT в строке.

## Численные показатели

Во всех строках ниже статус — **реализация в исходниках**, а не реальные данные нашей G30. Звёздочка означает, что сам upstream пометил масштаб как предположение.

| Показатель | Источник / обработчик | Единицы, масштаб и недопустимость | Обновление / тип |
|---|---|---|---|
| Скорость | `Vehicle2.statusCarSpeed2.speedVehicleCentreOfGravity`; bimmer `kit/runtime/car.js`, наш `retro_source.js` | raw ×0.015625 км/ч; raw<0/≥65535/нечисло недоступно | Быстрое, прямое; события + getters с проверкой свежести. |
| RPM | `CDS.statusEngineSpeed2.actualValueRPMEngineCrankshaft`; те же | raw ×0.25 об/мин; raw<0/≥65535 недоступно | Быстрое, прямое. |
| Масло / ОЖ | `CDS.statusEngineTemperature.temperatureEngineOilDrive` / `temperatureEngineDrive`; те же | raw−48 °C; raw<0/≥255 недоступно | Медленные температуры, прямые. |
| Литры топлива | `KombiIF.statusRangeTankStatus.fluidLevelFuelTank`; bimmer `hud.js::_setupVehicleData`, idrive7 `live_data/signals.js` | raw литры, <0/≥255 недоступно. Процент = 100×литры/подтверждённый объём бака; при `tankLitres:null` процента нет. | Медленное прямое. Бак из модели автомобиля не угадывается. |
| Запас хода | `KombiIF.statusRangeTankStatus.range`; те же | raw км; <0/≥4095 недоступно | Штатный расчёт автомобиля; не функция процента топлива в нашем приложении. |
| Одометр | `KombiIF.statusRangeTankStatus.mileageKilometre`; alt `VehicleInformation.Range.mileageKilometre`; Live Data `odo` | raw км; <0/≥16777215 недоступно | Медленное прямое; альтернативное поле требует независимого подтверждения. Не логировать без необходимости. |
| Наружная температура | `EnvironmentalInformation.ExteriorTemperature.temperatureExterior`; bimmer `hud.js`, Car Vitals | raw×0.5−40 °C; <0/≥255 недоступно | Медленное прямое. |
| Наддув* | `FES.statusSwitchDriveDynamicSport2.displayBoostPressure`; bimmer `_boost`, Live Data `boost` | raw×0.01 bar, <0/≥255 недоступно. Live Data и Car Vitals прямо называют FES scaling предположительным. | Динамическое; на G30 сверить масштаб и относительное/абсолютное давление. До этого качество «не подтверждено». |
| Момент двигателя | `FES.statusActualValueTorque2.actualValueTorqueCrankshaft`; Live Data `torque`, bimmer `Car` | raw×0.5−1023.5 Н·м; 12bit, <0/≥4095 недоступно; отрицательное означает торможение двигателем | Динамическое прямое сообщение ECU; не измерение на стенде мощности. |
| Мощность | idrive7 `live_data/signals.js::power`, `redline/hud.js::readoutsFor` | кВт=max(0,момент Н·м)×RPM/9549; только при двух актуальных входах | Вычисляемая из ECU, не диностенд. Спортивные % и максимумы не использовать как измерение мощности. |
| Спортивные % | `FES.statusVehicleDynamicEngine.displaySportEnginePower` / `displaySportEngineTorque`; bimmer `_setupVehicleData` | проценты шкалы; 255 недоступно. `statusVehicleDynamicEngineMaxValue` содержит raw максимумы | Исходники есть; не нужны для получения абсолютных кВт/Н·м при наличии прямого момента. |
| Продольное / поперечное G | `CDS2.statusLongitudinalAccelerationMassCenter.longitudinalAccelerationCentreOfGravity` / `statusLateralAccelerationMassCenter.lateralAccelerationCentreOfGravity`; Live Data `gLong/gLat`, bimmer `Car` | (raw×0.002−65)/9.80665 g; <0/≥65535 недоступно | Динамическое прямое ускорение, нормализованное в g; сглаживание не должно сохранять значения после утраты источника. |
| Средний расход BC1/BC2* | `KombiIF.statusBordcomputerAverage.consumptionAverage1BC1` / `consumptionAverage2BC2`; Live Data `avgCons1/2` | raw×0.1; <0/≥65535 недоступно. Для BC1 с метрической единицей масштаб сопоставлен владельцем со штатным экраном в одной сессии; остальные единицы остаются неподтверждёнными. Обязательно `statusUnitOfMeasurementConsumptionBC`:1/VERBRAUCH_IN_L_S_100KM=l/100km,2/…MPG_UK,3/…MPG_US,4/…KM_S_L. Масштаб автора `q:true` | Медленное; подписывать **БК1** / **БК2**, не «текущая поездка». Интервал штатного сброса здесь неизвестен. |
| Время BC | `KombiIF.statusBordcomputerTravelData.rideDurationHours/rideDurationMinutes`; Live Data `tripTime` | часы0…65534, минуты0…59; время=часы×60+минуты. Не делить raw неопределённым коэффициентом | Медленное штатное; интервал BC не приравнивать к текущему запуску приложения. |
| Расстояние BC* | `KombiIF.statusBordcomputerTravelData.wayPassed`; Live Data `tripDist` | raw км, <0/≥65535 недоступно; `q:true` | Медленное штатное; масштаб и сброс требуют сверки. |
| Мгновенный расход / л/ч | Live Data `Flow`, `main.js::dmeFuel/tripFuel`; подробнее ниже | Надёжного уже масштабированного пассивного поля не найдено. `CDS2.statusInjectionVolume.injectionVolumeFuelEngine` используется как 16bit счётчик с обучаемым коэффициентом | Пока недоступно в автомобильном профиле без отдельной проверенной калибровки/источника; не применять тестовый коэффициент. |
| Штатный текущий/средний расход, raw | idrive7 `redline/powerlog.js::FIELDS/start` | `de.bmw.infotainment.resetlogic.ResetLogic.currentConsumption` / `averageConsumption`; члены и масштабы не расшифрованы, upstream пишет структуру целиком только для изучения | Есть пассивная подписка, **нет** достоверной нормализации. Не выводить как л/100км. |
| Топливо за поездку | Live Data `trips.js::Trips.feed` | интеграл актуального л/ч по времени; при пропусках неполная сумма | Вычисляемое. Нет источника л/ч → нет достоверных литров/среднего за поездку. |
| Температура впуска | bimmer `hud.js::_startDme/_raw`, `cluster_themes/app.json::config.dme.intake`; Car Vitals `app.json::config.dme.iat` | DME ECU0x12: UDS22 F40F или OBD01 PID0F, raw−40°C; F477 byte1 является температурой охладителя, не безусловно тем же датчиком | Диагностическое чтение есть в upstream; пассивный источник не найден. Для текущей версии не включать автоматически, показывать недоступно. |

Полные имена коротких интерфейсов: CDS/CDS2/Vehicle/Vehicle2/TPMS — `de.bmw.infotainment.vehicle.*`; FES — `de.bmw.infotainment.drivingexcitement.FES`; KombiIF — `de.bmw.infotainment.KombiIF`; VehicleInformation/EnvironmentalInformation — `de.bmw.infrastructure.*`.

## Четыре колеса: единицы обязательны

Использования: Car Vitals `main.js::tyreP/tyreT/watches`, Redline `tyres.js::pressure/temperature/handlers`, bimmer `shared/hud.js::_tyreBar/_tyreC` и `_setupVehicleData`.

- `TPMS.statusTyrePressure.actualValuePressureTyreFLH/FRH/RLH/RRH`: raw×0.1 **в единицах автомобиля**, не безусловно bar. raw≥65532, отрицательные и нечисловые значения недоступны.
- `TPMS.statusTyreTemperature.actualValueTemperatureTyreFLH/FRH/RLH/RRH`: raw−40 **в единицах автомобиля**; raw65535 недоступен. После преобразования разумный диапазон исходника −40…150°C.
- `Vehicle.statusNewCurrentUnitsStatusExt.unitOfMeasurementAirPressure`:1/BAR,2/KPA,3/PSI. В bar: множители1,0.01,1/14.5038.
- `…unitOfMeasurementTemperature`:1/C,2/F. Для F: (raw−40−32)×5/9 °C.
- `statusTargetTyrePressure.targetPressureTyreFLH/FRH/RLH/RRH` — целевое давление с теми же единицами; источник найден, необязателен для первой строки показаний.

Upstream умеет угадывать bar/psi/kPa по диапазону и Fahrenheit по ранее увиденному psi. Эта эвристика **не является доказательством** и не должна подменять недоступный сигнал единиц. Каждое колесо имеет собственное состояние доступности; отсутствие одного не обнуляет остальные и не подставляет значение соседнего. У Redline срок хранения10мин, у Car Vitals опрос10с. Это авторские настройки для редких стояночных событий, не известная частота нашей G30. Наши значения инвалидируются при потере TPMS/единиц/сне; чтение getters допускается лишь при активном автомобиле.

## Расчёты и исключённые предположения

`Live Data signals.js::Flow` рассматривает впрыск как счётчик16bit: Δ=(raw−previous+65536)%65536, rate=ΣΔ/Σdt; окно≥1с. После разрыва>5с или Δ>40000 накопление сбрасывается. `l/h=rate×k`; k автор обучает по отдельному диагностическому расходу DME, а не выводит из модели540i. В тестовой функции `demo()` встречается k=0.0036 — это **не автомобильная калибровка**. Не переносится поведение `rateAt`, возвращающее0 после3с тишины: потеря сигнала должна означать недоступность.

Дополнительные кандидаты из [Redline fuel.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/9f0f68afe8407e80c411d9be92519528c3f6f023/apps/redline/fuel.js)::`candidates`: DME0x12, UDS22 DID5656, u16×0.00119209ml/s×3.6→л/ч; OBD01 PID5E, u16×0.05л/ч; UDS22 DID4521, u16×0.1кг/ч с делением на выбранную плотность топлива. Автор прямо отмечает: масштабы взяты из каталога, ещё не проверены на автомобиле. Это диагностические запросы, не разрешение подключить постоянный опрос; автоматический fallback и условная плотность здесь не используются.

При подтверждённом л/ч и скорости>0: `л/100км=100×(л/ч)/(км/ч)`; около нуля результат нестабилен, исходник использует порог5км/ч. На стоянке разрешены только настоящие л/ч, иначе прочерк. Литры поездки=Σ(л/ч×dt/3600000); расстояние=Σ(км/ч×dt/3600000); среднее=100×литры/км при достаточной дистанции и **полном** покрытии данных. Пропуск топлива не равен нулевому расходу. Сохранение поездки не даёт разрешения показывать её вчерашние текущие состояния.

Для перевода подтверждённого штатного среднего: mpgUS→л/100км=235.214583/mpgUS; mpgUK→282.480936/mpgUK; km/l→100/(km/l). Неизвестная единица или нулевой знаменатель недоступны. Результат сохраняет метку интервала BC1/BC2.

Буст DME в upstream вычисляется `(абсолютное kPa−baro kPa)/100`; там есть резервная константа101.3kPa. Без реального baro такая константа — предположение, которое здесь не принимается. Профиль двигателя, программа коробки, DSC и общий FES никогда не выводятся друг из друга.

## Фактический предел RPM и синяя зона холодного двигателя

Дополнительный аудит pinned bimmer-apps, Robert idrive-apps и MGU Store не обнаружил реализованного пассивного источника текущего разрешённого максимума оборотов, штатной синей границы или нормализованного live power-limit. Это отрицательный результат поиска в публичных исходниках, не доказательство отсутствия сигнала на G30. Полный охват, точные ссылки и offline-поиск метаданных: [`COLD_RPM_SIGNAL.md`](COLD_RPM_SIGNAL.md).

- `CDS.statusEngineSpeed2.actualValueRPMEngineCrankshaft` × 0,25 — **текущий RPM**, invalid 65535; он не сообщает допустимый максимум. Подписка и начальный getter реализованы, реальная частота на G30 не установлена.
- `Vehicle2.statusVehiclePartType.typeEngine` существует как обработчик в `kit/runtime/engine.js`; в приложениях bimmer его подключение не найдено. `scaleMax`/`redline` этого модуля — настройка или вычисление по статическому petrol/diesel профилю.
- `shared/shift_score.js::_ownPoint` — авторский расчёт подсказки по маслу 30…80 °C с шагом 50 об/мин и cold-порогом 4500. Это **не прямое показание ECU**. Факт движения и время после запуска не доказывают границу.
- `smart_temps` окрашивает текст температуры; его синий цвет не даёт отдельного автомобильного RPM-сигнала.

Для будущего источника предел должен иметь подтверждённые единицы, масштаб, invalid-коды и жизненный цикл availability/сна. Пока этого нет, состояние недоступно; температура, сохранённое значение, профиль и симуляция не заменяют реальную границу. Наличие кандидата в локальном master-каталоге подтверждает только метаданные. Ни одного настоящего ответа такого сигнала с автомобиля пользователя пока нет.

## План read-only проверки

Конкретная процедура: `READ_ONLY_SIGNALS.md`. Нужны availability, raw только перечисленных членов, время/поколение и результат нормализации; никаких VIN, ключей, полного дампа каталогов или неограниченного логирования. До такой сверки поля с `q:true` не становятся подтверждёнными лишь от того, что на стенде выглядят правдоподобно.


## Ручной сбор в 0.3.3

Страница iDrive **«Проверка данных»** собирает ограниченный raw-отчёт после явного нажатия, до 30 с. Добавлены только разрешения чтения/подписки CDS2.statusInjectionVolume и ResetLogic.currentConsumption/averageConsumption. Постоянный `RetroSource` не подключает их как готовые расход/л/ч. Метаданные ResetLogic нужны для выбора допустимых членов; неизвестная структура не выгружается целиком. Инспектируются также существующие KombiIF/FES/DSC-поля, включая BC2, единицу BC и максимум спортивного наддува.

Статус на выпуск 0.3.3: реализовано и проверено синтетическими тестами/локальным стендом. Для 0.3.4 получены фотографии реальных ответов от владельца G30; различие между наличием ответов и подтверждённой расшифровкой описано ниже. Raw и выбранные описания типов показываются обычным списком iDrive для ручного фотографирования. Полный ограниченный отчёт сохраняется локально; список разделён на страницы, предел и пропуски отмечаются явно. Автоматической публикации нет. Единицы, масштаб и смысл системных состояний из одного правдоподобного числа не выводятся. [Процедура и источники](DIAGNOSTICS.md), [выпуск 0.3.3](RELEASE_0.3.3.md).

## Наблюдения владельца для 0.3.4

Фотографии настоящего списка iDrive подтверждают получение полей KombiIF топлива/запаса/BC1/BC2, FES наддува/максимума, трёх qualifier стабилизации, счётчика впрыска CDS2 и структур ResetLogic current/averageConsumption. Снимки и их полная расшифровка хранятся локально вне Git; публикация не содержит фотографий автомобиля или полного набора наблюдений.

Владелец подтвердил работу двигателя при сборе и совпадение метрического среднего расхода БК1 со штатным экраном. В `retro_source.js` допускается только единица 1 или `VERBRAUCH_IN_L_S_100KM`, масштаб ×0.1, интервал — штатный БК1. У reading есть отметка `metric-scale-owner-G30-single-sample`; это одно сопоставление, не полная сертификация протокола. Другие единицы/DEFAULT/неизвестные значения не допускаются. Показатель не становится мгновенным расходом или расходом за нашу поездку; автоматической замены слота текущего расхода нет.

Доступный литровый источник не подтверждает ёмкость бака для процента. Нулевой наддув не проверяет коэффициент масштаба или gauge/absolute семантику. Полученные DSC qualifier без таблицы состояния остаются сырыми кодами. Нули ResetLogic с DEFAULT не подтверждают нулевые л/ч. Изменение счётчика впрыска подтверждает поток отсчётов, но не коэффициент перевода в литры. Эти ограничения сохраняются в автомобильном коде.
