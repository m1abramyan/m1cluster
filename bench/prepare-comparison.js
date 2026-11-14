'use strict';
// Writes only disposable comparison/reference state, never the normal bench user's settings.
const fs=require('fs'),path=require('path');
const fixture=require('./fixture.json');
const {defaults,writeAtomic}=require('../apps/manuk_retro_cluster/config');
const reference=path.join(__dirname,'.data/reference'),comparison=path.join(__dirname,'.data/comparison');
fs.mkdirSync(reference,{recursive:true});fs.mkdirSync(comparison,{recursive:true});
fs.writeFileSync(path.join(reference,'settings.json'),JSON.stringify(fixture.settings,null,2)+'\n');
const config=defaults('bench');config.units='us';config.clock='12h';config.language='en';
config.profiles.enabled=false;
writeAtomic(path.join(comparison,'manuk_retro_cluster.json'),config);
fs.writeFileSync(path.join(__dirname,'../artifacts/comparison-config.json'),JSON.stringify(config,null,2)+'\n');
console.log('Prepared isolated .data/reference and .data/comparison; normal bench settings preserved.');
