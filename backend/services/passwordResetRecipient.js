async function passwordResetRecipient(client,profile,email){
 if(profile.role!=='student')return email;
 const child=await client.from('children').select('parent_id').eq('auth_uid',profile.id).maybeSingle();
 if(child.error)throw child.error;
 if(!child.data?.parent_id)return null;
 const parent=await client.auth.admin.getUserById(child.data.parent_id);
 if(parent.error)throw parent.error;
 const recipient=parent.data?.user?.email;
 return typeof recipient==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)?recipient:null;
}
module.exports={passwordResetRecipient};
