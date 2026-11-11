const {verificationEmail}=require('../lib/emailTemplates');
/** Email-safe markup: inline styles, presentation tables, and a copyable code. */
function otpEmailTemplate({code,purpose='verification',expiresInMinutes}={}) {
  const value=String(code??'');
  if(!/^(?:\d{6}|\d{8})$/.test(value))throw new TypeError('Expected a 6 or 8 digit verification code');
  if(!['verification','password-reset'].includes(purpose))throw new TypeError('Invalid code purpose');
  if(expiresInMinutes!==undefined&&(!Number.isInteger(expiresInMinutes)||expiresInMinutes<1||expiresInMinutes>1440))throw new TypeError('Invalid code expiry');
  const reset=purpose==='password-reset';
  const title=reset?'I-reset ang iyong password':'Kumpirmahin ang iyong email';
  const introduction=reset
    ?'Gamitin ang code sa ibaba upang gumawa ng bagong password para sa account na humiling ng reset.'
    :'Ilagay ang code sa LinawLetra upang makumpirma ang iyong email at makapagpatuloy.';
  const expiry=expiresInMinutes===undefined
    ?'Gamitin ang pinakabagong code. Kung paso na ito, humiling ng panibago sa LinawLetra.'
    :`Mag-e-expire ang code sa loob ng ${expiresInMinutes} minuto.`;
  const ignore=reset
    ?'Kung hindi ikaw ang humiling ng password reset, maaari mong balewalain ang email na ito.'
    :'Kung hindi ikaw ang humiling ng code, maaari mong balewalain ang email na ito.';
  const subject=`LinawLetra — ${title}`;
  const text=`LinawLetra\nSuporta sa pagbasa\n\n${title}\n\n${introduction}\n\n${value}\n\n${expiry}\n\nHuwag ibahagi ang code sa kahit sino.\n${ignore}\n\nAwtomatikong email mula sa LinawLetra.`;
  const html=verificationEmail(value,{purpose,expiry});
  return {subject,text,html};
}
module.exports={otpEmailTemplate};
