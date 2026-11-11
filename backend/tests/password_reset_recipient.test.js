const test=require('node:test'),assert=require('node:assert/strict');
const {passwordResetRecipient}=require('../services/passwordResetRecipient');
const fixture=({missing=false,error=false}={})=>({from(){const q={select(){return q;},eq(key,id){assert.equal(key,'auth_uid');assert.equal(id,'student');return q;},async maybeSingle(){return{data:missing?null:{parent_id:'parent'},error:error?{code:'private'}:null};}};return q;},auth:{admin:{getUserById:async id=>{assert.equal(id,'parent');return{data:{user:{email:'parent@example.test'}}};}}}});
test('student password reset goes to the linked parent inbox',async()=>assert.equal(await passwordResetRecipient(fixture(),{id:'student',role:'student'},'student@linawletra.edu.ph'),'parent@example.test'));
test('parent reset retains its own email without querying child relationships',async()=>assert.equal(await passwordResetRecipient({}, {id:'parent',role:'parent'},'parent@example.test'),'parent@example.test'));
test('missing parent never falls back to an undeliverable synthetic student inbox',async()=>assert.equal(await passwordResetRecipient(fixture({missing:true}),{id:'student',role:'student'},'student@linawletra.edu.ph'),null));
test('failed ownership lookup cannot send to an unverified recipient',async()=>assert.rejects(passwordResetRecipient(fixture({error:true}),{id:'student',role:'student'},'student@linawletra.edu.ph')));
