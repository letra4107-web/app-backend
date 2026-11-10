const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createEmailVerificationGuard}=require('../middleware/emailVerification');
async function check({profile={role:'parent',email_verified:false},confirmed=true,child=null,path='/parent-children/child-id',fail=false}={}) {
 let called=false,status=200,body;
 const client={auth:{getUser:async()=>({data:{user:{id:'actor',email_confirmed_at:confirmed?'2026-11-10':null}}})},from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='users'?profile:child,error:fail?Error('db'):null})};return q;}};
 await createEmailVerificationGuard(client)({path,headers:{authorization:'Bearer token'},method:'POST'},{status:n=>{status=n;return {json:b=>{body=b;}};}},()=>{called=true;});return {called,status,body};
}
test('confirmed Auth session cannot bypass missing app OTP verification',async()=>{const result=await check();assert.equal(result.status,403);assert.equal(result.body.code,'EMAIL_VERIFICATION_REQUIRED');assert.equal(result.called,false);});
test('only both verification records permit protected parent API access',async()=>{assert.equal((await check({profile:{role:'parent',email_verified:true}})).called,true);assert.equal((await check({profile:{role:'parent',email_verified:true},confirmed:false})).status,403);});
test('missing profile and database errors fail closed',async()=>{assert.equal((await check({profile:null})).status,403);assert.equal((await check({fail:true})).status,503);});
test('enrolled students retain username access',async()=>{assert.equal((await check({profile:{role:'student'},confirmed:false})).called,true);assert.equal((await check({profile:null,child:{id:'child'}})).called,true);});
test('pending accounts can send and verify a code and recover passwords',async()=>{for(const path of ['/auth/send-otp','/auth/resend-otp','/auth/verify-otp','/auth/request-password-reset','/auth/cancel-verification'])assert.equal((await check({path})).called,true);});
