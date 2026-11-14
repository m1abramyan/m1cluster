'use strict';
// Reproduce concurrent rebuilds using temporary source copies and isolated loopback ports.
// Never reads or changes the running user's bench state, settings, or source files.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn } = require('child_process');
const scene = require('./scene-check');
const ROOT = path.resolve(__dirname, '..'), APP = 'manuk_retro_cluster';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ports() {
    const listeners = [net.createServer(), net.createServer()];
    await Promise.all(listeners.map(s => new Promise(resolve => s.listen(0, '127.0.0.1', resolve))));
    const values = listeners.map(s => s.address().port);
    await Promise.all(listeners.map(s => new Promise(resolve => s.close(resolve))));
    return values;
}
async function wait(get, predicate, label) {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
        let snapshot;
        try { snapshot = await get(); } catch (_) { /* Server can still be starting. */ }
        if (snapshot && predicate(snapshot)) return snapshot;
        await sleep(75);
    }
    throw new Error('Timed out: ' + label);
}
const ready = s => scene.ready(s) && s.values.visual && s.values.visual.driveMode === 'COMFORT';
async function stop(server) {
    if (server.child.exitCode !== null || server.child.signalCode) return;
    await new Promise(resolve => {
        const force = setTimeout(() => server.child.kill('SIGKILL'), 3000);
        server.child.once('exit', () => { clearTimeout(force); resolve(); });
        server.child.kill('SIGTERM');
    });
}
(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-bench-concurrency-'));
    const servers = [], ownedStages = [];
    try {
        const selectedPorts = await ports();
        for (let index = 0; index < 2; index++) {
            const source = path.join(temp, 'source-' + index), appDir = path.join(source, 'apps', APP);
            fs.mkdirSync(path.dirname(appDir), { recursive: true }); fs.cpSync(path.join(ROOT, 'apps', APP), appDir, { recursive: true });
            ['shared', 'kit'].forEach(name => fs.symlinkSync(path.join(ROOT, name), path.join(source, name), 'dir'));
            ['LICENSE', 'UPSTREAM.lock.json'].forEach(name => fs.copyFileSync(path.join(ROOT, name), path.join(source, name)));
            const child = spawn(process.execPath, [path.join(__dirname, 'server.js'), APP], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { BENCH_ROOT: source, BENCH_DATA_DIR: path.join(temp, 'data-' + index), BENCH_PORT: String(selectedPorts[index]), BENCH_FIXTURE: 'profiles', BENCH_CLOCK: '14:36' }) });
            const server = { child, source, appDir, port: selectedPorts[index], logs: '' }; servers.push(server);
            child.stdout.on('data', b => { server.logs += b.toString(); }); child.stderr.on('data', b => { server.logs += b.toString(); });
            server.get = async () => { const r = await fetch('http://127.0.0.1:' + server.port + '/snapshot'); assert(r.ok); return r.json(); };
            server.post = async route => { const r = await fetch('http://127.0.0.1:' + server.port + route, { method: 'POST' }); assert(r.ok); };
        }
        const initial = await Promise.all(servers.map((s, i) => wait(s.get, ready, 'server ' + i + ' startup')));
        initial.forEach(s => ownedStages.push(s.buildRoot));
        assert.notEqual(initial[0].buildRoot, initial[1].buildRoot); assert.notEqual(initial[0].stage, initial[1].stage);
        initial.forEach(s => {
            assert(s.buildRoot.includes(path.join('.build', 'instances')));
            assert(fs.existsSync(path.join(s.stage, 'source/javascript/kit/app-spec.json')));
            assert(fs.readFileSync(path.join(s.buildRoot, 'sdk-stub/index.js'), 'utf8').includes('BENCH_STUB'));
        });
        let peakChildren = 0;
        for (let round = 0; round < 3; round++) {
            const before = await Promise.all(servers.map(s => s.get()));
            await Promise.all(servers.map(server => Promise.all(Array.from({ length: 10 }, () => server.post('/restart')))));
            const after = await Promise.all(servers.map((server, i) => wait(server.get, s => {
                peakChildren = Math.max(peakChildren, s.appPids.length);
                assert(s.appPids.length <= 1, 'overlapping app processes');
                return ready(s) && s.childPid !== before[i].childPid;
            }, 'parallel restart ' + round)));
            after.forEach(s => { assert.equal(s.appPids.length, 1); assert.equal(s.childPid, s.appPids[0]); assert.equal(s.values.visual.gear, 4); });
            assert(!servers.some(s => /FileExistsError|ENOENT|build failed:/.test(s.logs)), 'concurrent build failed');
        }
        // A broken source affects only its own server and has an explicit local-build status.
        const appJson = path.join(servers[0].appDir, 'app.json'), valid = fs.readFileSync(appJson);
        fs.writeFileSync(appJson, '{invalid');
        const failed = await wait(servers[0].get, s => !s.running && s.status && /Не удалось собрать локальное приложение/.test(s.status.s), 'clear build-failure status');
        assert.equal(failed.values, null); assert.equal(failed.childPid, null);
        assert(ready(await servers[1].get()), 'other server must remain running');
        const failures = (servers[0].logs.match(/build failed:/g) || []).length;
        await sleep(800);
        assert.equal((servers[0].logs.match(/build failed:/g) || []).length, failures, 'no automatic restart loop');
        fs.writeFileSync(appJson, valid); await wait(servers[0].get, ready, 'recovery after explicit source fix');
        // Shutdown while a restart is pending must not launch a replacement child.
        await servers[0].post('/restart'); await stop(servers[0]);
        assert(servers[0].child.exitCode !== null || servers[0].child.signalCode);
        const result = { scope: 'Local temporary source copies, random loopback ports; user bench untouched', checks: ['simultaneous builds use different instance stages and SDK stubs', 'three bursts of ten restart requests per server coalesce without overlapping app processes', 'one build failure leaves the other server running', 'build failure clears cached values and shows a Russian local-build error', 'failed build does not retry until source is explicitly fixed', 'shutdown during restart exits without restarting'], instanceBuildRoots: initial.map(s => s.buildRoot), peakObservedAppChildren: peakChildren };
        fs.writeFileSync(path.join(ROOT, 'artifacts/bench-concurrency-verification.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await Promise.all(servers.map(stop));
        fs.rmSync(temp, { recursive: true, force: true });
        ownedStages.forEach(stage => { if (stage.startsWith(path.join(__dirname, '.build', 'instances') + path.sep)) fs.rmSync(stage, { recursive: true, force: true }); });
    }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
