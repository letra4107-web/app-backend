const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-only';
const express=require('express'),{readingFeedback}=require('../services/readingFeedback'),{createReadingAttemptsRouter,extractLessonText,readingChunks}=require('../routes/readingAttempts'),{createParentChildrenRouter,validBirthDate}=require('../routes/parentChildren');
const id=n=>`59000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const invoke=async(router,url,body,token='student',method='POST')=>{
 const app=express();app.use(express.json());app.use(router);const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
 try{const res=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json()};}finally{await new Promise(r=>server.close(r));}
};
function fake({role='student',owned=true}={}){
 const calls=[],client={auth:{getUser:async()=>({data:{user:{id:id(1),email_confirmed_at:'2026-01-01'}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return {data:{success:true,...args},error:null};},from(table){
  const conditions={};const result=()=>({data:table==='users'?{role}:table==='children'?owned?{id:id(2),auth_uid:id(1),parent_id:id(1)}:null:table==='mobile_reading_events'?owned?{id:id(3),expected_text:'ako ay may isang aso',target_kind:'content'}:null:null,error:null});
  const query={select(){return this;},eq(key,value){conditions[key]=value;return this;},maybeSingle:async()=>{calls.push({table,conditions});return result();},single:async()=>result()};return query;}};
 return {client,calls};
}
test('word alignment: exact, missing, extra and wrong words; PDF 80/70 bands',()=>{
 const exact=readingFeedback('Ako ay may isang aso.','ako ay may isang aso');assert.equal(exact.accuracy,100);assert.equal(exact.correct,true);
 const omitted=readingFeedback('Ako ay may isang aso.','ako ay may isang');assert.equal(omitted.accuracy,80);assert.equal(omitted.band,'correct');assert.equal(omitted.words.at(-1).status,'missing');
 assert.equal(readingFeedback('isa dalawa tatlo apat lima anim pito walo siyam sampu','isa dalawa tatlo apat lima anim pito').band,'close');
 const wrong=readingFeedback('magkapatid','iba');assert.equal(wrong.correct,false);assert.ok(wrong.words[0].practiceSyllables.length<=3);assert.ok(wrong.note.includes('hindi pagsusuri'));
 assert.ok(readingFeedback('ako','ako ikaw').extraWords.includes('ikaw'));assert.throws(()=>readingFeedback('a '.repeat(1001),'a'),/mahaba/);
});
test('new save accepts transcript only and forwards the server score with authenticated student identity',async()=>{
 const {client,calls}=fake(),router=createReadingAttemptsRouter({client});const result=await invoke(router,`/${id(3)}`,{transcript:'ako ay may isang',durationSeconds:7});assert.equal(result.status,200);const save=calls.find(c=>c.name);assert.equal(save.args.p_student_id,id(2));assert.equal(save.args.p_accuracy,80);assert.equal(calls.find(c=>c.table==='mobile_reading_events').conditions.student_id,id(2));
});
test('claimed score and foreign events cannot be recorded',async()=>{
 const a=fake();assert.equal((await invoke(createReadingAttemptsRouter({client:a.client}),`/${id(3)}`,{transcript:'a',accuracy:100})).status,400);assert.equal(a.calls.filter(c=>c.name).length,0);
 const b=fake({owned:false});assert.equal((await invoke(createReadingAttemptsRouter({client:b.client}),`/${id(3)}`,{transcript:'a'})).status,403);
 const c=fake();assert.equal((await invoke(createReadingAttemptsRouter({client:c.client}),'/start',{kind:'content',targetId:id(3),requestId:id(4)},'')).status,401);
});
test('PDF extraction refuses foreign hosts before network access and keeps chunks bounded',async()=>{
 let fetched=false;await assert.rejects(extractLessonText('https://attacker.test/private',{fetchImpl:()=>{fetched=true;}}),/extract/);assert.equal(fetched,false);assert.equal(readingChunks('salita '.repeat(250))[0].split(' ').length,100);assert.equal(readingChunks('salita '.repeat(250)).length,3);
});
test('parent edits reject nonparents, foreign children, invalid and future birthdates',async()=>{
 assert.equal(validBirthDate('2020-02-30','2026-11-10'),false);assert.equal(validBirthDate('2027-01-01','2026-11-10'),false);assert.equal(validBirthDate('2020-02-29','2026-11-10'),true);
 const a=fake();assert.equal((await invoke(createParentChildrenRouter(a.client),`/${id(2)}`,undefined,'student','GET')).status,403);
 const b=fake({role:'parent',owned:false});assert.equal((await invoke(createParentChildrenRouter(b.client),`/${id(2)}`,undefined,'parent','GET')).status,404);
 const c=fake({role:'parent'});assert.equal((await invoke(createParentChildrenRouter(c.client),`/${id(2)}`,{name:'Ana',gradeLevel:1,dateOfBirth:'2999-01-01',revision:0},'parent','PATCH')).status,400);assert.equal(c.calls.filter(c=>c.name).length,0);
});
