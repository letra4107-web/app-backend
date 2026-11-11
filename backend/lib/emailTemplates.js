
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

// ==========================================
// LINAWLETRA EMAIL DESIGN SYSTEM
// ==========================================

const BRAND = {
  primary: '#103F70',
  secondary: '#14528B',
  heading: '#173B62',
  text: '#52677D',
  muted: '#64788D',
  background: '#F3F6FB',
  lightBlue: '#F2F7FC',
  border: '#DCE9F5',
  gold: '#956D20',
  goldBg: '#FFF8E9',
  green: '#287747',
  greenBg: '#E8F6ED',
};

// ==========================================
// MAIN EMAIL LAYOUT
// ==========================================

function emailLayout({
  preheader,
  title,
  greeting,
  intro,
  content,
  note,
  category = 'LINAWLETRA',
}) {
  return `<!DOCTYPE html>
<html lang="fil">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">

  <style>
    @media only screen and (max-width:600px) {
      .email-shell {
        width:100% !important;
      }

      .email-pad {
        padding-left:20px !important;
        padding-right:20px !important;
      }

      .email-shell td { overflow-wrap:anywhere;word-break:break-word; }
      .email-title {
        font-size:25px !important;
      }
    }
  </style>

  <title>${escapeHtml(title)} | LinawLetra</title>
</head>

<body style="
  margin:0;
  padding:0;
  background-color:${BRAND.background};
  font-family:Arial,Helvetica,sans-serif;
  color:#19324D;
">

  <!-- PREHEADER -->
  <div style="
    display:none;
    font-size:1px;
    color:${BRAND.background};
    line-height:1px;
    max-height:0;
    max-width:0;
    opacity:0;
    overflow:hidden;
  ">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="background-color:${BRAND.background};">

    <tr>
      <td align="center" style="padding:24px 12px;">

        <!-- MAIN CONTAINER -->
        <table role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          class="email-shell"
          style="
            width:100%;
            max-width:580px;
            background-color:#ffffff;
            border-radius:16px;
            overflow:hidden;
          ">

          <!-- HEADER -->
          <tr>
            <td style="
              padding:27px 30px;
              background-color:${BRAND.primary};
            ">

              <table role="presentation"
                cellspacing="0"
                cellpadding="0"
                border="0">

                <tr>
                  <td valign="middle"
                    style="
                      width:44px;
                      height:44px;
                      background-color:#ffffff;
                      border-radius:10px;
                      text-align:center;
                      vertical-align:middle;
                    ">

                    <span style="
                      font-size:25px;
                      font-weight:700;
                      color:${BRAND.primary};
                    ">
                      L
                    </span>

                  </td>

                  <td style="
                    padding-left:12px;
                    vertical-align:middle;
                  ">

                    <div style="
                      font-size:21px;
                      font-weight:700;
                      color:#ffffff;
                      letter-spacing:0.3px;
                    ">
                      LinawLetra
                    </div>

                    <div style="
                      padding-top:4px;
                      font-size:12px;
                      letter-spacing:1.2px;
                      color:#D6E9FA;
                    ">
                      PLATFORM FOR LEARNING
                    </div>

                  </td>
                </tr>

              </table>

            </td>
          </tr>

          <!-- MAIN CONTENT -->
          <tr>
            <td class="email-pad" style="
              padding:30px 28px 16px;
            ">

              <div style="
                display:inline-block;
                padding:7px 12px;
                border-radius:20px;
                background-color:${BRAND.lightBlue};
                color:${BRAND.secondary};
                font-size:12px;
                font-weight:700;
                letter-spacing:1px;
              ">
                ${escapeHtml(category)}
              </div>

              <h1 class="email-title" style="
                margin:19px 0 15px;
                font-size:28px;
                line-height:1.35;
                color:${BRAND.heading};
                font-weight:700;
              ">
                ${escapeHtml(title)}
              </h1>

              <p style="
                margin:0 0 12px;
                font-size:16px;
                line-height:1.8;
                color:${BRAND.text};
              ">
                ${escapeHtml(greeting)}
              </p>

              <p style="
                margin:0;
                font-size:15px;
                line-height:1.85;
                color:${BRAND.text};
              ">
                ${escapeHtml(intro)}
              </p>

            </td>
          </tr>

          <!-- DYNAMIC CONTENT -->
          <tr>
            <td class="email-pad" style="
              padding:16px 28px 26px;
            ">
              ${content}
            </td>
          </tr>

          <!-- SECURITY / NOTE -->
          <tr>
            <td style="padding:0 28px 28px;">

              <table role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0">

                <tr>
                  <td style="
                    border-top:1px solid #E5EDF5;
                    padding-top:18px;
                    font-size:14px;
                    line-height:1.8;
                    color:#62758A;
                  ">
                    ${escapeHtml(note)}
                  </td>
                </tr>

              </table>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="
              padding:23px 25px;
              background-color:#F3F6FA;
              border-top:1px solid #E8EDF3;
              text-align:center;
            ">

              <p style="
                margin:0 0 7px;
                font-size:13px;
                line-height:1.7;
                color:${BRAND.muted};
              ">
                Awtomatikong ipinadala ang email na ito mula sa LinawLetra.
                Mangyaring huwag tumugon.
              </p>

              <p style="
                margin:0;
                font-size:13px;
                line-height:1.7;
                color:${BRAND.muted};
              ">
                © 2026 LinawLetra. All rights reserved.
              </p>

            </td>
          </tr>

        </table>

        <!-- BOTTOM BRANDING -->
        <div style="
          padding:17px 8px 0;
          font-size:12px;
          color:#64788D;
          text-align:center;
        ">
          PAGBASA NANG MALINAW, HAKBANG-HAKBANG
        </div>

      </td>
    </tr>

  </table>

</body>
</html>`;
}

// ==========================================
// REUSABLE COMPONENTS
// ==========================================

// OTP / VERIFICATION CODE CARD

function codeCard(code, label = 'VERIFICATION CODE') {
  return `
  <table class="email-code" role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      border:1px solid ${BRAND.border};
      border-radius:12px;
      background-color:${BRAND.lightBlue};
    ">

    <tr>
      <td align="center" style="padding:27px 15px;">

        <div style="
          font-size:13px;
          font-weight:700;
          letter-spacing:1.5px;
          color:${BRAND.text};
        ">
          ${escapeHtml(label)}
        </div>

        <p dir="ltr" style="
          margin:0;white-space:nowrap;font-family:Courier New,monospace;
          padding-top:14px;
          font-size:32px;
          font-weight:700;
          letter-spacing:5px;
          color:${BRAND.secondary};
        ">${escapeHtml(code)}</p>

        <p style="
          margin:13px 0 0;
          font-size:13px;
          line-height:1.6;
          color:${BRAND.muted};
        ">
          Ilagay ang code sa kaukulang verification page.
        </p>

      </td>
    </tr>

  </table>`;
}

// GENERAL CREDENTIAL CARD

function credentialCard({ username, password }) {
  return `
  <table role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      border:1px solid ${BRAND.border};
      border-radius:12px;
      background-color:${BRAND.lightBlue};
    ">

    <tr>
      <td style="padding:18px 19px;">

        <div style="
          font-size:12px;
          font-weight:700;
          letter-spacing:1px;
          color:#52677D;
        ">
          USERNAME
        </div>

        <div style="
          padding-top:7px;
          font-size:16px;
          font-weight:700;
          line-height:1.6;
          color:${BRAND.heading};
          word-break:break-word;
        ">
          ${escapeHtml(username)}
        </div>

        <div style="
          margin:15px 0;
          border-top:1px solid ${BRAND.border};
        "></div>

        <div style="
          font-size:12px;
          font-weight:700;
          letter-spacing:1px;
          color:#52677D;
        ">
          TEMPORARY PASSWORD
        </div>

        <div style="
          padding-top:7px;
          font-size:16px;
          font-weight:700;
          line-height:1.6;
          color:${BRAND.heading};
          word-break:break-word;
        ">
          ${escapeHtml(password)}
        </div>

      </td>
    </tr>

  </table>`;
}

// STUDENT CREDENTIAL CARD

function studentCredentialCard({ username, password }) {
  return `
  <table role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0">

    <tr>
      <td style="
        padding-bottom:7px;
        font-size:13px;
        font-weight:700;
        letter-spacing:1px;
        color:${BRAND.text};
      ">
        STUDENT USERNAME
      </td>
    </tr>

    <tr>
      <td style="
        padding:14px 16px;
        border:1px solid ${BRAND.border};
        border-radius:10px;
        background-color:${BRAND.lightBlue};
        font-size:16px;
        font-weight:700;
        line-height:1.6;
        color:${BRAND.heading};
        word-break:break-word;
      ">
        ${escapeHtml(username)}
      </td>
    </tr>

    <tr>
      <td style="
        height:16px;
        font-size:1px;
        line-height:16px;
      ">
        &nbsp;
      </td>
    </tr>

    <tr>
      <td style="
        padding-bottom:7px;
        font-size:13px;
        font-weight:700;
        letter-spacing:1px;
        color:${BRAND.gold};
      ">
        PANSAMANTALANG PASSWORD
      </td>
    </tr>

    <tr>
      <td style="
        padding:14px 16px;
        border:1px solid #F0DFB2;
        border-radius:10px;
        background-color:#FFFBF1;
        font-size:16px;
        font-weight:700;
        line-height:1.6;
        color:#875D08;
        word-break:break-word;
      ">
        ${escapeHtml(password)}
      </td>
    </tr>

  </table>`;
}

// INFORMATION / INSTRUCTION CARD

function instructionCard(title, instructions) {
  return `
  <table role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      margin-top:19px;
      border:1px solid #E5EDF5;
      border-radius:10px;
      background-color:#F8FAFC;
    ">

    <tr>
      <td style="padding:17px 18px;">

        <div style="
          font-size:13px;
          font-weight:700;
          color:${BRAND.heading};
          padding-bottom:10px;
        ">
          ${escapeHtml(title)}
        </div>

        <div style="
          font-size:14px;
          line-height:1.9;
          color:${BRAND.text};
        ">
          ${instructions.map((item, index) =>
            `<div style="padding-bottom:5px;">
              <span style="
                font-weight:700;
                color:${BRAND.secondary};
              ">
                ${index + 1}.
              </span>
              ${escapeHtml(item)}
            </div>`
          ).join('')}
        </div>

      </td>
    </tr>

  </table>`;
}

// SECURITY NOTICE CARD

function securityCard(message) {
  return `
  <table role="presentation"
    width="100%"
    cellspacing="0"
    cellpadding="0"
    border="0"
    style="
      margin-top:18px;
      border:1px solid #F2E5C5;
      border-radius:10px;
      background-color:${BRAND.goldBg};
    ">

    <tr>
      <td style="padding:16px 18px;">

        <div style="
          font-size:14px;
          font-weight:700;
          letter-spacing:.5px;
          color:${BRAND.gold};
          padding-bottom:7px;
        ">
          PAALALA SA SEGURIDAD
        </div>

        <div style="
          font-size:14px;
          line-height:1.8;
          color:#745D35;
        ">
          ${escapeHtml(message)}
        </div>

      </td>
    </tr>

  </table>`;
}

// ==========================================
// EMAIL 1: EMAIL VERIFICATION
// ==========================================

function verificationEmail(code, {purpose='verification',expiry='Gamitin ang pinakabagong code. Kung paso na ito, humiling ng panibago sa LinawLetra.'}={}) {
  const reset=purpose==='password-reset';
  return emailLayout({
    preheader: reset?'Gamitin ang code upang i-reset ang iyong password.':'Kumpirmahin ang iyong LinawLetra email address.',
    category: reset?'PASSWORD RESET':'EMAIL VERIFICATION',
    title: reset?'I-reset ang iyong password':'Kumpirmahin ang iyong email',
    greeting: reset?'Magandang araw!':'Maligayang pagdating sa LinawLetra!',
    intro: reset?'Gamitin ang code sa ibaba upang gumawa ng bagong password para sa account na humiling ng reset.':'Salamat sa paggawa ng iyong account. Ilagay ang verification code sa LinawLetra upang kumpirmahin ang iyong email at makapagpatuloy.',

    content:
      codeCard(code,reset?'PASSWORD RESET CODE':'VERIFICATION CODE') +
      '<p style="font-size:13px;line-height:1.7;color:#52677D;">'+escapeHtml(expiry)+'</p>'+
      securityCard(
        'Huwag ibahagi ang verification code na ito kaninuman. Kung hindi ikaw ang gumawa ng account, maaari mong balewalain ang email na ito.'
      ),

    note: reset?'Kung hindi ikaw ang humiling ng password reset, maaari mong balewalain ang email na ito.':'Kung hindi ikaw ang humiling ng code, maaari mong balewalain ang email na ito.',
  });
}

// ==========================================
// EMAIL 2: CHILD ENROLLMENT
// ==========================================

function childEnrollmentEmail({
  childName,
  gradeLevel,
  readingLevel,
  username,
  password,
}) {
  const safeName = escapeHtml(childName);

  return emailLayout({
    preheader: `Naka-enroll na si ${childName} sa LinawLetra.`,
    category: 'STUDENT ENROLLMENT',
    title: 'Tagumpay ang enrollment!',
    greeting: 'Magandang araw!',
    intro: `Naka-enroll na si ${childName} sa LinawLetra. Narito ang enrollment details at login credentials ng inyong anak.`,

    content: `
      <table role="presentation"
        width="100%"
        cellspacing="0"
        cellpadding="0"
        border="0"
        style="
          margin-bottom:19px;
          border:1px solid ${BRAND.border};
          border-radius:10px;
          background-color:${BRAND.lightBlue};
        ">

        <tr>
          <td style="padding:16px 18px;">

            <div style="
              font-size:12px;
              font-weight:700;
              letter-spacing:1px;
              color:#52677D;
            ">
              STUDENT INFORMATION
            </div>

            <div style="
              padding-top:9px;
              font-size:16px;
              font-weight:700;
              color:${BRAND.heading};
            ">
              ${safeName}
            </div>

            <div style="
              padding-top:6px;
              font-size:14px;
              line-height:1.7;
              color:${BRAND.text};
            ">
              Grade ${escapeHtml(gradeLevel)}<br>
              Reading Level: ${escapeHtml(readingLevel)}
            </div>

          </td>
        </tr>

      </table>

      ${studentCredentialCard({ username, password })}

      ${instructionCard('PAANO MAG-LOGIN', [
        'Buksan ang LinawLetra at piliin ang Mag-login.',
        'Ilagay ang ibinigay na username at pansamantalang password.',
        'Palitan ang pansamantalang password pagkatapos mag-login.',
        'Simulan ang mga reading activities.',
      ])}

      ${securityCard(
        'Itago nang maayos ang login credentials at ibahagi lamang sa inyong anak. Huwag ipadala ang password sa group chat o sa ibang tao.'
      )}
    `,

    note: 'Maligayang pagdating sa LinawLetra! Hangad namin ang mas masaya at makabuluhang pagkatuto para sa inyong anak.',
  });
}

// ==========================================
// EMAIL 3: PASSWORD RESET
// ==========================================

function passwordResetEmail({
  childName,
  username,
  password,
}) {
  return emailLayout({
    preheader: `Na-reset ang password ni ${childName}.`,
    category: 'PASSWORD RESET',
    title: 'Na-reset ang password',
    greeting: 'Magandang araw!',
    intro: `Na-reset na ang password ng LinawLetra account ni ${childName}. Narito ang bagong login credentials.`,

    content: `
      ${credentialCard({ username, password })}

      ${instructionCard('ANO ANG SUSUNOD NA GAGAWIN?', [
        'Buksan ang LinawLetra login page.',
        'Ilagay ang username at bagong pansamantalang password.',
        'Mag-login sa account.',
        'Palitan agad ang pansamantalang password.',
      ])}

      ${securityCard(
        'Panatilihing pribado ang login credentials. Ibahagi lamang ang mga ito sa may-ari ng account o sa awtorisadong tagapag-alaga.'
      )}
    `,

    note: 'Kung hindi ikaw ang humiling ng password reset, makipag-ugnayan agad sa administrator ng LinawLetra.',
  });
}

// ==========================================
// EMAIL 4: TEACHER ACCOUNT
// ==========================================

function teacherAccountEmail({
  name,
  email,
  password,
  verificationCode,
}) {
  return emailLayout({
    preheader: 'Nagawa na ang iyong LinawLetra teacher account.',
    category: 'TEACHER ACCOUNT',
    title: 'Maligayang pagdating sa LinawLetra',
    greeting: `Magandang araw, ${name}!`,
    intro: 'Matagumpay nang nagawa ang iyong teacher account. Gamitin ang mga detalye sa ibaba upang mag-login at kumpirmahin ang iyong email address.',

    content: `
      <div style="
        padding-bottom:12px;
        font-size:14px;
        font-weight:700;
        letter-spacing:1px;
        color:${BRAND.text};
      ">
        YOUR LOGIN CREDENTIALS
      </div>

      ${credentialCard({
        username: email,
        password,
      })}

      <div style="
        height:22px;
        font-size:1px;
        line-height:22px;
      ">
        &nbsp;
      </div>

      <div style="
        padding-bottom:12px;
        font-size:14px;
        font-weight:700;
        letter-spacing:1px;
        color:${BRAND.text};
      ">
        EMAIL VERIFICATION
      </div>

      ${codeCard(verificationCode)}

      ${instructionCard('MGA SUSUNOD NA HAKBANG', [
        'Mag-login gamit ang iyong teacher credentials.',
        'Kumpirmahin ang iyong email gamit ang verification code.',
        'Palitan ang pansamantalang password.',
        'Simulan ang paggamit ng iyong teacher account.',
      ])}

      ${securityCard(
        'Huwag ibahagi ang iyong password o verification code. Palitan agad ang pansamantalang password pagkatapos mag-login.'
      )}
    `,

    note: 'Salamat sa pagiging bahagi ng LinawLetra. Sama-sama nating gawing mas malinaw at mas makabuluhan ang pagkatuto!',
  });
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  verificationEmail,
  childEnrollmentEmail,
  passwordResetEmail,
  teacherAccountEmail,
};
