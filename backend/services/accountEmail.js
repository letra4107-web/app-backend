const duplicateEmailMessage='May account nang gumagamit ng email na ito. Gumamit ng ibang email o mag-login.';
function canonicalAccountEmail(value){
 const email=String(value||'').trim().toLowerCase(),[local,domain]=email.split('@');
 return ['gmail.com','googlemail.com'].includes(domain)?local.split('+')[0].replace(/\./g,'')+'@gmail.com':email;
}
async function accountEmailInUse(client,email,exceptId=null){
 const result=await client.rpc('account_email_in_use',{p_email:email,p_except_id:exceptId});
 if(result.error)throw result.error;
 if(typeof result.data!=='boolean')throw Error('Email check unavailable');
 return result.data;
}
module.exports={canonicalAccountEmail,accountEmailInUse,duplicateEmailMessage};
