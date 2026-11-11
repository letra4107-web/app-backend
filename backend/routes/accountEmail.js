const express=require('express');
const {supabaseAdmin}=require('../config/supabase');
const {accountEmailInUse}=require('../services/accountEmail');
const router=express.Router(),requests=new Map();
router.post('/email-availability',async(req,res)=>{
 const now=Date.now();
 for(const [key,value] of requests)if(now-value.start>=60000)requests.delete(key);
 const key=req.ip||req.socket.remoteAddress,entry=requests.get(key)||{start:now,count:0};
 res.set('Cache-Control','no-store');
 if(++entry.count>8||requests.size>=10000&&!requests.has(key))return res.status(429).json({message:'Maghintay ng isang minuto bago subukan muli.'});
 requests.set(key,entry);
 const email=String(req.body?.email||'').trim().toLowerCase();
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({message:'Ilagay ang wastong email address.'});
 try{return res.json({available:!await accountEmailInUse(supabaseAdmin,email)});}
 catch{return res.status(503).json({message:'Hindi masuri ang email ngayon. Subukan muli mamaya.'});}
});
module.exports=router;
