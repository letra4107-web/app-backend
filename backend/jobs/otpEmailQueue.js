const {sendOTPEmail,smtpConfigured}=require('../config/mailer');
let sequence=0;
async function enqueueOtpEmail({label,userId,email,otp}){
 const id='otp-email-'+Date.now()+'-'+(++sequence);
 if(!smtpConfigured)throw Object.assign(new Error('Hindi pa handa ang serbisyo ng email. Subukan muli mamaya.'),{code:'MAIL_UNAVAILABLE'});
 try{
   const info=await sendOTPEmail(email,otp);
   console.log('[otp-email] provider accepted',{jobId:id,label,userId,messageId:info.messageId});
   return {queued:false,sent:true,jobId:id};
 }catch(error){
   console.error('[otp-email] provider rejected',{jobId:id,label,code:error.code,status:error.responseCode,message:error.message});
   throw Object.assign(new Error('Hindi naipadala ang code. Subukan muli mamaya o makipag-ugnayan sa administrator.'),{code:'MAIL_UNAVAILABLE'});
 }
}
module.exports={enqueueOtpEmail};
