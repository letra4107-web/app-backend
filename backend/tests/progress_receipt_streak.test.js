const assert=require('node:assert/strict');const {test}=require('node:test');
const {recordProgressEvent}=require('../services/progressEvents');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('mobile v2 reply includes the committed streak without changing reward or reading level',async()=>{
 const client={from(table){const q={select(){return q;},eq(){return q;},async maybeSingle(){return{data:table==='child_progress'?{streak:2,longest_streak:3,last_practice_date:'2026-11-10'}:{student_id:id(1),content_id:id(2),expected_text:'bata',source:'practice',channel:'mobile'}};}};return q;},async rpc(name){return name==='progress_contract_version'?{data:{version:2}}:{data:{success:true,replayed:false,xpAwarded:0,progress:{child_id:id(1),xp:175,total_attempts:2,achievements:[],streak:0,level:'Beginner'},result:{attempt_id:id(4),accuracy:100},baseReward:{rewardType:'content_practice',contentId:id(2),status:'already_rewarded',xpAwarded:0},newlyPersistedAchievementIds:[]}};}};
 const result=await recordProgressEvent(client,id(1),id(3),{transcript:'bata'});
 assert.equal(result.progress.streak,2);assert.equal(result.progress.xp,175);assert.equal(result.progress.level,'Beginner');assert.equal(result.xpAwarded,0);
});
