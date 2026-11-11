const {test}=require('node:test'),assert=require('node:assert/strict');
const {otpEmailTemplate}=require('../services/otpEmailTemplate');
test('verification renders the complete 6/8 digit code once as selectable text with a plain text fallback',()=>{
 for(const code of ['001234','00123456']){
  const mail=otpEmailTemplate({code});assert.match(mail.subject,/Kumpirmahin ang iyong email/);
  assert.equal(mail.html.split(code).length-1,1);assert.match(mail.html,new RegExp('>'+code+'</p>'));
  assert.match(mail.text,new RegExp('\\n\\n'+code+'\\n\\n'));assert.match(mail.html,/Huwag ibahagi/);
  assert.doesNotMatch(mail.html,/<script|<form|display:flex|<img|src=|https?:\/\//i);
 }
});
test('password reset has the correct purpose and only claims a lifetime when supplied by the caller',()=>{
 const reset=otpEmailTemplate({code:'001234',purpose:'password-reset',expiresInMinutes:10});
 assert.match(reset.html,/I-reset ang iyong password/);assert.match(reset.text,/10 minuto/);
 const verification=otpEmailTemplate({code:'12345678'});assert.doesNotMatch(verification.text,/\d+ minuto/);assert.match(verification.text,/pinakabagong code/);
});
test('rejects malformed codes and untrusted purpose/expiry before rendering HTML',()=>{
 for(const code of ['12345','1234567','123456789','<img src=x onerror=alert(1)>','１２３４５６',null])assert.throws(()=>otpEmailTemplate({code}),TypeError);
 assert.throws(()=>otpEmailTemplate({code:'123456',purpose:'<script>'}),TypeError);
 for(const expiresInMinutes of [0,-1,1.5,'10',NaN,Infinity])assert.throws(()=>otpEmailTemplate({code:'123456',expiresInMinutes}),TypeError);
});
