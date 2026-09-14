import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReel, createSpinController} from '../webapp/static/js/roulette.mjs';

test('reel lands on every possible server prize, never a locally drawn winner', () => {
  const catalog = Array.from({length:20}, (_,i)=>({code:`prize_${i}`}));
  for (const prize of catalog) {
    const {items,index} = buildReel(catalog,prize.code);
    assert.equal(items[index].code,prize.code);
    assert.ok(index>40);
    assert.ok(items.length>index+1);
  }
  assert.throws(()=>buildReel(catalog,'unknown'));
});

test('double click shares one request and retry preserves its key', async () => {
  let resolve, calls=0, saved=null;
  const controller=createSpinController(async key=>{calls++;saved=key;return new Promise(r=>resolve=r);}, {
    loadKey:()=>null, saveKey:()=>{}, clearKey:()=>{}, newKey:()=> 'fixed-request-key'
  });
  const first=controller.spin(), second=controller.spin();
  assert.equal(calls,1);
  resolve({code:'prize_1'});
  assert.deepEqual(await first,await second);
  assert.equal(saved,'fixed-request-key');
  assert.equal(controller.recovering,true);
  controller.acknowledge();
  assert.equal(controller.recovering,false);
});

test('uncertain result survives reload and definitive rejection clears key', async () => {
  let stored='original-key';
  const storage={loadKey:()=>stored,saveKey:key=>stored=key,clearKey:()=>stored=null,newKey:()=> 'new-key'};
  const failed=createSpinController(async key=>{assert.equal(key,'original-key');throw new Error('network');},storage);
  await assert.rejects(failed.spin());
  assert.equal(stored,'original-key');
  const retry=createSpinController(async key=>{assert.equal(key,'original-key');throw Object.assign(new Error('balance'),{retryable:false});},storage);
  await assert.rejects(retry.spin());
  assert.equal(stored,null);
});
