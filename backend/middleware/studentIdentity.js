const createStudentGuard = client => async (req,res,next) => {
  try {
    const token=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if(!token)return res.status(401).json({success:false,code:'AUTH_REQUIRED',message:'Authentication is required.'});
    const {data:auth,error}=await client.auth.getUser(token);
    if(error||!auth?.user?.id)return res.status(401).json({success:false,code:'AUTH_EXPIRED',message:'Your sign-in session is invalid or expired.'});
    const {data:child,error:childError}=await client.from('children').select('id').eq('auth_uid',auth.user.id).maybeSingle();
    if(childError)throw childError;
    if(!child?.id)return res.status(403).json({success:false,code:'STUDENT_REQUIRED',message:'This endpoint is available only to student accounts.'});
    req.authenticatedStudentId=child.id;return next();
  }catch{return res.status(503).json({success:false,message:'Unable to verify the signed-in student.'});}
};
module.exports={createStudentGuard};
