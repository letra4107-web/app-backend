/** Email-safe markup: inline styles, presentation tables, and a copyable code. */
function otpEmailTemplate({code,purpose='verification',expiresInMinutes}={}) {
  const value=String(code??'');
  if(!/^(?:\d{6}|\d{8})$/.test(value))throw new TypeError('Expected a 6 or 8 digit verification code');
  if(!['verification','password-reset'].includes(purpose))throw new TypeError('Invalid code purpose');
  if(expiresInMinutes!==undefined&&(!Number.isInteger(expiresInMinutes)||expiresInMinutes<1||expiresInMinutes>1440))throw new TypeError('Invalid code expiry');
  const reset=purpose==='password-reset';
  const title=reset?'I-reset ang iyong password':'Kumpirmahin ang iyong email';
  const label=reset?'PASSWORD RESET':'EMAIL VERIFICATION';
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
  const html=`<!doctype html>
<html lang="fil">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title} | LinawLetra</title>
  <style>
    @media only screen and (max-width:480px){.email-outer{padding:24px 12px!important}.email-section{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:25px!important;line-height:33px!important}}
    @media (prefers-color-scheme:dark){.email-bg{background-color:#111b25!important}.email-card{background-color:#1c2935!important;border-color:#3a4a59!important}.email-heading{color:#f2f6fa!important}.email-copy{color:#d0dbe5!important}.email-muted{color:#aabac9!important}.email-rule{border-color:#3a4a59!important}.email-code{background-color:#26354a!important;border-color:#7f72c8!important}.email-code-text{color:#e1d9ff!important}.email-security{background-color:#223b38!important;border-color:#4e7a6d!important}.email-brand{color:#67d5bd!important}.email-brand-accent{color:#c5b4ff!important}}
  </style>
</head>
<body class="email-bg" bgcolor="#eef3f6" style="margin:0;padding:0;width:100%;background-color:#eef3f6;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;color:#233546;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${title}. Gamitin ang code sa loob ng email upang magpatuloy.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td class="email-outer" align="center" style="padding:40px 16px;">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dce5eb;border-radius:18px;border-collapse:separate;overflow:hidden;">
        <tr><td height="5" bgcolor="#128576" style="height:5px;background-color:#128576;font-size:0;line-height:0;border-radius:18px 18px 0 0;">&nbsp;</td></tr>
        <tr><td class="email-section email-rule" style="padding:28px 36px 24px;border-bottom:1px solid #e7edf1;">
          <p style="margin:0;font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.8px;"><span class="email-brand" style="color:#087b70;">Linaw</span><span class="email-brand-accent" style="color:#6c50ad;">Letra</span></p>
          <p class="email-muted" style="margin:5px 0 0;font-size:11px;line-height:17px;letter-spacing:1.8px;color:#697c8d;">SUPORTA SA PAGBASA</p>
        </td></tr>
        <tr><td class="email-section" style="padding:32px 36px 0;">
          <p class="email-brand" style="margin:0 0 12px;font-size:11px;line-height:17px;letter-spacing:1.8px;font-weight:700;color:#087b70;">${label}</p>
          <h1 class="email-title email-heading" style="margin:0;font-size:29px;line-height:37px;letter-spacing:-0.7px;font-weight:700;color:#203246;">${title}</h1>
          <p class="email-copy" style="margin:16px 0 0;font-size:16px;line-height:26px;color:#526779;">${introduction}</p>
        </td></tr>
        <tr><td class="email-section" style="padding:26px 36px 0;">
          <table class="email-code" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f3fc" style="background-color:#f5f3fc;border:1px solid #ded7f3;border-radius:12px;">
            <tr><td align="center" style="padding:19px 12px 21px;">
              <p class="email-muted" style="margin:0 0 8px;font-size:11px;line-height:18px;letter-spacing:1.5px;font-weight:700;color:#74638e;">ANG IYONG CODE</p>
              <p class="email-code-text" dir="ltr" style="margin:0;font-family:'Courier New',Courier,monospace;font-size:36px;line-height:46px;letter-spacing:5px;font-weight:700;color:#593d99;white-space:nowrap;">${value}</p>
            </td></tr>
          </table>
          <p class="email-muted" style="margin:14px 0 0;font-size:13px;line-height:21px;color:#697c8d;">${expiry}</p>
        </td></tr>
        <tr><td class="email-section" style="padding:25px 36px 30px;">
          <table class="email-security" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eff8f4" style="background-color:#eff8f4;border-left:3px solid #72ad95;border-radius:0 8px 8px 0;">
            <tr><td style="padding:15px 17px;">
              <p class="email-heading" style="margin:0 0 5px;font-size:13px;line-height:21px;font-weight:700;color:#255e50;">Para sa iyong seguridad</p>
              <p class="email-copy" style="margin:0;font-size:13px;line-height:21px;color:#45675e;">Huwag ibahagi ang code sa kahit sino.</p>
            </td></tr>
          </table>
          <p class="email-copy" style="margin:20px 0 0;font-size:13px;line-height:22px;color:#65798a;">${ignore}</p>
        </td></tr>
        <tr><td class="email-section email-rule" style="padding:20px 36px;border-top:1px solid #e7edf1;">
          <p class="email-muted" style="margin:0;font-size:12px;line-height:20px;color:#788b9b;">Awtomatikong email mula sa <strong>LinawLetra</strong>.</p>
          <p class="email-muted" style="margin:2px 0 0;font-size:12px;line-height:20px;color:#788b9b;">Kasama mo sa bawat hakbang ng pagkatuto.</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
  return {subject,text,html};
}
module.exports={otpEmailTemplate};
