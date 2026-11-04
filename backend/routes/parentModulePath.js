'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createParentModulePathHandler(client){return async(req,res)=>{
 res.set('Cache-Control','private, no-store');
 const match=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
 if(!match)return res.status(401).json({success:false,message:'Authentication is required.'});
 if(!UUID.test(req.params.childId||''))return res.status(400).json({success:false,message:'A valid child ID is required.'});
 try{
  const {data:auth,error:authError}=await client.auth.getUser(match[1].trim());
  if(authError||!auth?.user?.id)return res.status(401).json({success:false,message:'Your sign-in session is invalid or expired.'});
  const {data:profile,error:roleError}=await client.from('users').select('role').eq('id',auth.user.id).maybeSingle();
  if(roleError)throw roleError;if(profile?.role!=='parent')return res.status(403).json({success:false,message:'Parent access is required.'});
  const {data:child,error:childError}=await client.from('children').select('id').eq('id',req.params.childId).eq('parent_id',auth.user.id).maybeSingle();
  if(childError)throw childError;if(!child)return res.status(403).json({success:false,message:'You may only view your own child.'});
  const {data:path,error:pathError}=await client.rpc('get_student_module_path',{p_student_id:child.id});
  if(pathError)throw pathError;if(!path||!Array.isArray(path.modules))throw new Error('Invalid module path result');
  return res.json({success:true,path});
 }catch{return res.status(503).json({success:false,message:'Hindi ma-load ang mga modyul. Subukan muli.'});}
};}
module.exports={createParentModulePathHandler};
