const assert=require('node:assert/strict');const {test}=require('node:test');
const mailer=require.resolve('../config/mailer');let send;
require.cache[mailer]={id:mailer,filename:mailer,loaded:true,exports:{smtpConfigured:true,sendOTPEmail:(...args)=>send(...args)}};
const {enqueueOtpEmail}=require('../jobs/otpEmailQueue');
test('OTP response waits for provider acceptance and sends once',async()=>{
 let finish,calls=0;send=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 let returned=false;const pending=enqueueOtpEmail({label:'QA',userId:'qa',email:'qa@example.invalid',otp:'not-a-real-code'}).then(result=>{returned=true;return result;});
 await Promise.resolve();assert.equal(returned,false);assert.equal(calls,1);finish({messageId:'provider-id'});
 const result=await pending;assert.equal(result.sent,true);assert.equal(result.queued,false);assert.equal(calls,1);
});
test('provider failure cannot be reported as a successful queued email and is not automatically resent',async()=>{
 let calls=0;send=async()=>{calls++;throw Object.assign(new Error('unrecognized IP'),{responseCode:401});};
 await assert.rejects(enqueueOtpEmail({label:'QA',email:'qa@example.invalid',otp:'not-a-real-code'}),error=>error.code==='MAIL_UNAVAILABLE');assert.equal(calls,1);
});
