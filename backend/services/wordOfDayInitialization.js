const todayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function loadWordOfDay(client,studentId){
 const date=todayKey();
 const read=()=>client.from('word_of_day_log').select('*').eq('child_id',studentId).eq('date',date).maybeSingle();
 const existing=await read();if(existing.error)throw existing.error;if(existing.data)return existing.data;
 const {data:progress,error:levelError}=await client.rpc('get_student_reading_progress',{p_student_id:studentId});
 if(levelError)throw levelError;
 if(!['Beginner','Intermediate','Advanced'].includes(progress?.effective_level))throw new Error('Invalid official reading level.');
 const {data:words,error}=await client.from('reading_content').select('id,content_text').eq('content_type','word').eq('is_active',true).eq('level',progress.effective_level).order('id').limit(500);
 if(error)throw error;if(!words?.length)return null;
 const index=Math.abs([...`${studentId}-${date}`].reduce((sum,char)=>sum+char.charCodeAt(0),0))%words.length;
 const chosen=words[index];
 const result=await client.from('word_of_day_log').upsert({child_id:studentId,word:chosen.content_text,date,attempts:0,content_id:chosen.id},{onConflict:'child_id,date',ignoreDuplicates:true}).select('*').maybeSingle();
 if(result.error)throw result.error;if(result.data)return result.data;
 const concurrent=await read();if(concurrent.error)throw concurrent.error;
 if(!concurrent.data)throw new Error('Daily word could not be initialized.');return concurrent.data;
}
module.exports={loadWordOfDay};
