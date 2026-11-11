const express = require('express');
const { randomBytes, randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const { supabaseAdmin } = require('../config/supabase');
const { UUID, rpcFailure } = require('../services/progressEvents');

function validBirthDate(value, today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())) {
 if(value==null||value==='')return true;const [year,month,day]=today.split('-').map(Number),y=year-7,last=new Date(Date.UTC(y,month,0)).getUTCDate();const cutoff=y+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<=cutoff&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
function createParentChildrenRouter(client = supabaseAdmin) {
  const router = express.Router();
  router.use(async (req,res,next) => {
    try {
      const token=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      if(!token) return res.status(401).json({success:false,message:'Mag-login muna.'});
      const auth=await client.auth.getUser(token);
      if(auth.error||!auth.data?.user?.email_confirmed_at) return res.status(401).json({success:false,message:'Mag-login gamit ang verified account.'});
      const profile=await client.from('users').select('role').eq('id',auth.data.user.id).maybeSingle();
      if(profile.error) throw profile.error;
      if(profile.data?.role!=='parent') return res.status(403).json({success:false,message:'Para lamang sa magulang ang pagkilos na ito.'});
      req.parentId=auth.data.user.id; next();
    } catch { res.status(503).json({success:false,message:'Hindi ma-verify ang account. Subukan muli.'}); }
  });
  const owned = async (req) => {
    if(!UUID.test(req.params.childId||'')) throw Object.assign(new Error('Hindi wastong estudyante.'),{status:400});
    const result=await client.from('children').select('id,auth_uid,parent_id,name,grade_level,date_of_birth,username,profile_revision').eq('id',req.params.childId).eq('parent_id',req.parentId).maybeSingle();
    if(result.error) throw result.error;
    if(!result.data) throw Object.assign(new Error('Hindi nakaugnay sa iyong account ang estudyanteng ito.'),{status:404});
    return result.data;
  };
  const fail=(res,error)=>res.status(error.status||503).json({success:false,message:error.status?error.message:'Hindi makumpleto ang pagkilos. Subukan muli.'});
  router.get('/:childId',async(req,res)=>{try{res.json({success:true,child:await owned(req)});}catch(error){fail(res,error);}});
  router.patch('/:childId',async(req,res)=>{
    try {
      await owned(req);
      const {name,gradeLevel,dateOfBirth,revision}=req.body||{};
      if(typeof name!=='string'||name.trim().length<2||name.trim().length>100||!Number.isInteger(gradeLevel)||gradeLevel<1||gradeLevel>6||!validBirthDate(dateOfBirth)||!Number.isInteger(revision)||revision<0) {
        return res.status(400).json({success:false,message:'Ilagay ang buong pangalan at baitang 1–6. Opsyonal ang birthday; dapat 7 taong gulang pataas kapag nilagyan.'});
      }
      const result=await client.rpc('update_parent_child_profile',{p_parent_id:req.parentId,p_child_id:req.params.childId,p_name:name.trim(),p_grade:gradeLevel,p_birth_date:dateOfBirth||null,p_revision:revision});
      if(result.error) throw rpcFailure(result.error);
      res.json({success:true,child:result.data});
    } catch(error) { fail(res,error); }
  });
  router.post('/:childId/credentials',async(req,res)=>{
    try {
      const child=await owned(req),requestId=req.body?.requestId;
      if(!UUID.test(requestId||'')) return res.status(400).json({success:false,message:'Magsimula ng bagong kahilingan para sa login.'});
      if(!child.auth_uid) return res.status(409).json({success:false,message:'Wala pang login account ang estudyanteng ito.'});
      const claim=await client.from('child_credential_requests').insert({id:requestId,child_id:child.id,parent_id:req.parentId});
      if(claim.error?.code==='23505') return res.status(409).json({success:false,message:'Naproseso na ang kahilingang ito. Pindutin ang Bagong Password upang gumawa ng panibago.'});
      if(claim.error) throw claim.error;
      const password=`Basa!${randomBytes(12).toString('base64url')}9a`;
      const updated=await client.auth.admin.updateUserById(child.auth_uid,{password});
      if(updated.error) throw updated.error;
      const username=updated.data?.user?.email||child.username;
      const stored=await client.from('child_credentials').upsert({child_id:child.id,username,hashed_password:await bcrypt.hash(password,12),plain_password:null,password_rotated_at:new Date().toISOString(),plaintext_retired_at:new Date().toISOString()},{onConflict:'child_id'});
      if(stored.error) throw stored.error;
      res.set('Cache-Control','no-store');
      res.json({success:true,credentials:{username,password,requestId:requestId||randomUUID()}});
    } catch(error) { fail(res,error); }
  });
  return router;
}
module.exports=createParentChildrenRouter();
module.exports.createParentChildrenRouter=createParentChildrenRouter;
module.exports.validBirthDate=validBirthDate;
