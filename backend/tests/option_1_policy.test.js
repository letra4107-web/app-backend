const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recordProgressEvent,startProgressEvent}=require('../services/progressEvents');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function harness(status='awarded',replayed=false){
 const state={calls:[],channel:'mobile',source:'practice',fail:false};
 const data={success:true,replayed,xpAwarded:status==='awarded'?50:0,
  baseReward:{rewardType:'content_practice',contentId:id(301),status,xpAwarded:status==='awarded'?50:0},
  progress:{child_id:id(1),xp:175,total_attempts:2,achievements:[{id:'historic'}]},
  result:{attempt_id:id(600),accuracy:100,correct:true},newlyPersistedAchievementIds:[]};
 const client={from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{student_id:id(1),content_id:id(301),expected_text:'bata',channel:state.channel,source:state.source}};}};return q;},
  async rpc(name,args){if(name==='progress_contract_version')return{data:{version:2}};state.calls.push({name,args});return state.fail?{error:{code:'PGRST202',message:'private schema'}}:{data};}};
 return {state,data,client,submit:()=>recordProgressEvent(client,id(1),id(500),{transcript:'bata'})};
}
for(const status of ['awarded','already_rewarded','not_eligible','not_applicable','legacy_review_required'])
 test('OPTION1-B '+status+' keeps the stored official reward outcome',async()=>{const h=harness(status);const r=await h.submit();assert.equal(r.baseReward.status,status);assert.equal(r.progress.xp,175);assert.equal(r.xpAwarded,status==='awarded'?50:0);assert.equal(h.state.calls.length,1);assert.equal(h.state.calls[0].args.p_accuracy,100);});
test('OPTION1-B duplicate receipt returns zero additional payment',async()=>{const h=harness('already_rewarded',true);assert.equal((await h.submit()).xpAwarded,0);assert.equal((await h.submit()).replayed,true);});
test('OPTION1-B canonical content cannot be replaced by an arbitrary receipt identity',async()=>{const h=harness();h.data.baseReward.contentId=id(302);await assert.rejects(h.submit(),{status:503});});
test('OPTION1-B WOD namespace cannot enter the content reward response',async()=>{const h=harness();h.data.baseReward.rewardType='word_of_day';await assert.rejects(h.submit(),{status:503});});
test('OPTION1-B a replay claiming payment fails closed',async()=>{const h=harness('awarded',true);await assert.rejects(h.submit(),{status:503});});
test('OPTION1-B zero-XP web/assessment policy cannot be replaced by an unexpected payment',async()=>{for(const [channel,source]of [['web','practice'],['mobile','assessment']]){const h=harness();Object.assign(h.state,{channel,source});await assert.rejects(h.submit(),{status:503});}});
test('OPTION1-B missing receipt RPC fails safely without a legacy fallback',async()=>{const h=harness();h.state.fail=true;await assert.rejects(h.submit(),{status:503});assert.deepEqual(h.state.calls.map(c=>c.name),['record_student_progress_event']);});
test('OPTION1-B unsupported reward sources, client flags and identity overrides are rejected',async()=>{const h=harness();for(const body of [{contentId:id(301),source:'word_of_day'},{contentId:id(301),source:'activity'},{contentId:id(301),source:'practice',rewardType:'content_practice'},{contentId:id(301),source:'practice',alreadyRewarded:false},{contentId:id(301),source:'practice',newAttempt:'true'}])await assert.rejects(startProgressEvent(h.client,id(1),body),{status:400});assert.equal(h.state.calls.length,0);});
test('OPTION1-B old database contract cannot issue or consume events before the Option 1 ledger is installed',async()=>{
 for(const version of [1,undefined]){
  const calls=[];const client={rpc:async name=>{calls.push(name);return{data:{version}};},from(){throw new Error('Must fail before lookup or mutation');}};
  await assert.rejects(startProgressEvent(client,id(1),{contentId:id(301),source:'practice'}),{status:503});
  await assert.rejects(recordProgressEvent(client,id(1),id(500),{transcript:'bata'}),{status:503});
  assert.deepEqual(calls,['progress_contract_version','progress_contract_version']);
 }
});
