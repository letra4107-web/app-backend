const express=require('express');
const {createHash}=require('crypto');
const pdfParse=require('pdf-parse');
const {supabaseAdmin}=require('../config/supabase');
const {createStudentGuard}=require('../middleware/studentIdentity');
const {UUID,onlyKeys,rpcFailure}=require('../services/progressEvents');
const {readingFeedback,normalize}=require('../services/readingFeedback');
const failure=(status,message)=>Object.assign(new Error(message),{status});
const checked=result=>{if(result.error)throw rpcFailure(result.error);return result.data;};
const md5=value=>createHash('md5').update(value).digest('hex');
function readingChunks(raw){
 const cover=String(raw||'').match(/^[\s\S]{0,2000}?Ako Naman[.”"]*\s*/i);
 const text=(cover?raw.slice(cover[0].length):raw).replace(/\s+/g,' ').trim();
 const sentences=text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[];
 return sentences.flatMap(sentence=>{const words=sentence.trim().split(/\s+/);return Array.from({length:Math.ceil(words.length/100)},(_,index)=>words.slice(index*100,(index+1)*100).join(' '));}).filter(Boolean).slice(0,1000);
}
async function extractLessonText(url,{fetchImpl=fetch,pdfParser=pdfParse}={}){
 const parsed=new URL(url),allowed=new URL(process.env.SUPABASE_URL||process.env.EXPO_PUBLIC_SUPABASE_URL||'https://invalid.local');
 if(parsed.origin!==allowed.origin||!parsed.pathname.startsWith('/storage/v1/object/public/lesson-pdfs/'))throw failure(422,'Hindi ma-extract ang tekstong file na ito. Buksan muna ang orihinal na PDF.');
 const response=await fetchImpl(parsed,{signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!response.ok)throw failure(503,'Hindi mabasa ang PDF. Subukan muli.');
 if(Number(response.headers.get('content-length'))>20*1024*1024)throw failure(413,'Masyadong malaki ang PDF.');
 const reader=response.body.getReader(),buffers=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20*1024*1024)throw failure(413,'Masyadong malaki ang PDF.');buffers.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return (await pdfParser(Buffer.concat(buffers))).text||'';
}
function createReadingAttemptsRouter({client=supabaseAdmin,extract=extractLessonText}={}){
 const router=express.Router();router.use(createStudentGuard(client));
 const fail=(res,error)=>res.status(error.status||503).json({success:false,code:error.code||'READING_UNAVAILABLE',message:error.status?error.message:'Hindi ma-save ang pagbasa ngayon. Nananatili ang iyong sagot; subukan muli.'});
 router.get('/documents/:kind/:sourceId',async(req,res)=>{
  try{
   const {kind,sourceId}=req.params,student=req.authenticatedStudentId;
   if(!['pdf','lesson'].includes(kind)||!UUID.test(sourceId))throw failure(400,'Hindi wastong babasahin.');
   let raw,revision,title;
   if(kind==='pdf'){
    const assignment=checked(await client.from('pdf_assignments').select('id,pdf_materials(title,extracted_text)').eq('id',sourceId).eq('student_id',student).maybeSingle());
    if(!assignment)throw failure(404,'Hindi nakatalaga sa iyo ang babasahin.');
    const material=Array.isArray(assignment.pdf_materials)?assignment.pdf_materials[0]:assignment.pdf_materials;
    raw=material?.extracted_text||'';revision=md5(raw);title=material?.title||'Kuwento mula sa Guro';
   }else{
    const lesson=checked(await client.from('lessons').select('id,title,pdf_url,grade_level').eq('id',sourceId).eq('is_published',true).maybeSingle());
    const child=checked(await client.from('children').select('grade_level').eq('id',student).single());
    if(!lesson||(lesson.grade_level!=null&&!new RegExp(`^(?:grade\\s*)?${child.grade_level}$`,'i').test(String(lesson.grade_level).trim())))throw failure(404,'Walang araling nakabukas para sa iyong baitang.');
    if(!lesson.pdf_url)throw failure(422,'Wala pang PDF ang aralin.');
    revision=md5(lesson.pdf_url);title=lesson.title;
    const cached=checked(await client.from('mobile_reading_documents').select('*').eq('source_kind',kind).eq('source_id',sourceId).eq('source_revision',revision).maybeSingle());
    if(cached) return await sendDocument(res,student,cached);
    raw=await extract(lesson.pdf_url);
   }
   const chunks=readingChunks(raw);
   if(!chunks.length)throw failure(422,'Walang nabasang teksto sa PDF. Kailangan ng PDF na may napipiling teksto; maaari mo pa ring buksan ang orihinal.');
   const document=checked(await client.from('mobile_reading_documents').upsert({source_kind:kind,source_id:sourceId,source_revision:revision,title,chunks},{onConflict:'source_kind,source_id,source_revision'}).select('*').single());
   await sendDocument(res,student,document);
  }catch(error){fail(res,error);}
 });
 async function sendDocument(res,student,document){
  const completions=checked(await client.from('mobile_reading_page_completions').select('chunk_index').eq('student_id',student).eq('document_id',document.id));
  const events=checked(await client.from('mobile_reading_events').select('chunk_index,word_feedback,accuracy,response').eq('student_id',student).eq('document_id',document.id).not('response','is',null).order('issued_at',{ascending:false}).limit(1000));
  const pageFeedback={};for(const event of events||[])if(pageFeedback[event.chunk_index]===undefined)pageFeedback[event.chunk_index]=event;
  return res.json({success:true,document:{id:document.id,kind:document.source_kind,title:document.title,chunks:document.chunks,completedPages:(completions||[]).map(row=>row.chunk_index),pageFeedback}});
 }
 router.get('/assessment-responses/:attemptId',async(req,res)=>{
  try{
   if(!UUID.test(req.params.attemptId))throw failure(400,'Hindi wastong pagsusulit.');
   const rows=checked(await client.from('student_progress_events').select('id,assessment_item_id,content_attempt_id,response,expected_text,request').eq('student_id',req.authenticatedStudentId).eq('assessment_attempt_id',req.params.attemptId).not('response','is',null));
   const recent=checked(await client.from('mobile_reading_events').select('legacy_event_id,word_feedback').eq('student_id',req.authenticatedStudentId).eq('target_kind','assessment').not('response','is',null).order('issued_at',{ascending:false}).limit(1000));
   res.json({success:true,responses:(rows||[]).map(row=>({assessmentItemId:row.assessment_item_id,contentAttemptId:row.content_attempt_id,transcript:row.request?.transcript||'',accuracy:row.response?.result?.accuracy,feedback:recent.find(event=>event.legacy_event_id===row.id)?.word_feedback||null}))});
  }catch(error){fail(res,error);}
 });
 router.post('/start',async(req,res)=>{
  try{
   const body=req.body;
   if(!onlyKeys(body,['kind','targetId','requestId','chunkIndex','assessmentAttemptId','assessmentItemId'])||!UUID.test(body.targetId||'')||!UUID.test(body.requestId||'')||!['content','assessment','pdf','lesson'].includes(body.kind)
    ||(['pdf','lesson'].includes(body.kind)&&(!Number.isInteger(body.chunkIndex)||body.chunkIndex<0))
    ||(body.kind==='assessment'&&(!UUID.test(body.assessmentAttemptId||'')||!UUID.test(body.assessmentItemId||''))))throw failure(400,'Hindi wastong detalye ng pagsubok.');
   const event=checked(await client.rpc('start_mobile_reading_attempt',{p_student_id:req.authenticatedStudentId,p_request_id:body.requestId,p_kind:body.kind,p_target_id:body.targetId,p_chunk_index:body.chunkIndex??null,p_assessment_attempt_id:body.assessmentAttemptId||null,p_assessment_item_id:body.assessmentItemId||null}));
   res.json({success:true,...event});
  }catch(error){fail(res,error);}
 });
 router.post('/:eventId',async(req,res)=>{
  try{
   const body=req.body;
   if(!UUID.test(req.params.eventId)||!onlyKeys(body,['transcript','durationSeconds'])||typeof body.transcript!=='string'||!body.transcript.trim()||body.transcript.length>10000||(body.durationSeconds!=null&&(!Number.isInteger(body.durationSeconds)||body.durationSeconds<0||body.durationSeconds>3600)))throw failure(400,'I-record muna ang iyong pagbasa.');
   const event=checked(await client.from('mobile_reading_events').select('id,expected_text,legacy_event_id,target_kind').eq('id',req.params.eventId).eq('student_id',req.authenticatedStudentId).maybeSingle());
   if(!event)throw failure(404,'Hindi makita ang sarili mong pagsubok.');
   let feedback=readingFeedback(event.expected_text,body.transcript);
   if(event.target_kind==='assessment'){
    const bound=checked(await client.from('student_progress_events').select('assessment_item_id').eq('id',event.legacy_event_id).eq('student_id',req.authenticatedStudentId).single());
    const item=checked(await client.from('reading_module_assessment_items').select('answer_options,correct_answer_index').eq('id',bound.assessment_item_id).single());
    if(Array.isArray(item.answer_options)){
     const expected=item.answer_options[item.correct_answer_index];
     if(typeof expected!=='string')throw failure(503,'Hindi handa ang tanong.');
     feedback=readingFeedback(expected,body.transcript);feedback.accuracy=normalize(expected)===normalize(body.transcript)?100:0;feedback.correct=feedback.accuracy===100;
     feedback.band=feedback.correct?'perfect':'needs_practice';feedback.message=feedback.correct?'Tama ang sagot.':'Hindi pa tama ang sagot.';
    }
   }
   const result=checked(await client.rpc('record_mobile_reading_attempt',{p_student_id:req.authenticatedStudentId,p_event_id:event.id,p_transcript:body.transcript,p_duration:body.durationSeconds??null,p_accuracy:feedback.accuracy,p_feedback:feedback}));
   res.json(result);
  }catch(error){fail(res,error);}
 });
 router.post('/documents/:documentId/finish',async(req,res)=>{
  try{if(!UUID.test(req.params.documentId))throw failure(400,'Hindi wastong babasahin.');res.json(checked(await client.rpc('finish_mobile_reading_document',{p_student_id:req.authenticatedStudentId,p_document_id:req.params.documentId})));}catch(error){fail(res,error);}
 });
 return router;
}
module.exports=createReadingAttemptsRouter();module.exports.createReadingAttemptsRouter=createReadingAttemptsRouter;
module.exports.readingChunks=readingChunks;module.exports.extractLessonText=extractLessonText;
