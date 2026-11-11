const {test}=require('node:test'),assert=require('node:assert/strict');
// No network or real email: capture the exact payload passed to the provider.
process.env.BREVO_API_KEY='qa-template-test-only';
for(const key of ['SMTP_USER','SMTP_PASS','EMAIL_USER','EMAIL_PASS'])process.env[key]='';
const payloads=[];
global.fetch=async(url,options)=>{
 if(url==='https://api.brevo.com/v3/account')return {ok:true,status:200,text:async()=>'{}'};
 assert.equal(url,'https://api.brevo.com/v3/smtp/email');payloads.push(JSON.parse(options.body));
 return {ok:true,status:201,text:async()=>JSON.stringify({messageId:'qa-no-real-email'})};
};
const {sendOTPEmail,sendPasswordResetCodeEmail}=require('../config/mailer');
test('mobile verification and reset delivery both contain branded HTML and the original code as plain text',async()=>{
 await sendOTPEmail('qa@example.invalid','001234');await sendPasswordResetCodeEmail('qa@example.invalid','005678');
 assert.equal(payloads.length,2);
 for(const [index,code] of ['001234','005678'].entries()){
  const payload=payloads[index];assert.match(payload.htmlContent,/class="email-code"/);assert.match(payload.htmlContent,new RegExp('>'+code+'</p>'));
  assert.match(payload.textContent,new RegExp(code));assert.match(payload.textContent,/10 minuto/);assert.equal(payload.to[0].email,'qa@example.invalid');
 }
 assert.match(payloads[0].subject,/Kumpirmahin ang iyong email/);assert.match(payloads[1].subject,/I-reset ang iyong password/);
});
