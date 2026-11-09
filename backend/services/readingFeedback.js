// Word alignment is based on the recognized transcript, not phoneme detection.
// Syllables are practice suggestions; no unheard answer is substituted into STT.
const normalize = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fil-PH').replace(/[^a-z0-9ñ]/g,'');
const tokenize = value => String(value||'').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[];
function distance(a,b) {let previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next.push(Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1)));previous=next;}return previous[b.length];}
function syllables(word) {
 const cleaned=String(word).replace(/[^\p{L}-]/gu,'');
 if(cleaned.includes('-')) return cleaned.split('-').filter(Boolean);
 return cleaned.match(/(?:ng|[^aeiouAEIOU])*[aeiouAEIOU]+(?:(?![aeiouAEIOU])[^aeiouAEIOU](?=[^aeiouAEIOU]|$))?|[^aeiouAEIOU]+$/g)||[cleaned];
}
function readingFeedback(expectedText,transcript) {
 const expected=tokenize(expectedText),heard=tokenize(transcript),a=expected.map(normalize),b=heard.map(normalize);
 if(a.length>1000||b.length>1000)throw Object.assign(new Error('Masyadong mahaba ang isang bahagi ng pagbasa.'),{status:422});
 const table=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i===0?j:j===0?i:0));
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)table[i][j]=Math.min(table[i-1][j]+1,table[i][j-1]+1,table[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
 const words=[],extraWords=[];let i=a.length,j=b.length,earned=0;
 while(i||j){
  if(i&&j&&table[i][j]===table[i-1][j-1]+(a[i-1]===b[j-1]?0:1)){
   const correct=a[i-1]===b[j-1],similarity=correct?1:Math.max(a[i-1].length,b[j-1].length)>120?0:Math.max(0,1-distance(a[i-1],b[j-1])/Math.max(a[i-1].length,b[j-1].length))**1.6;
   earned+=similarity;words.unshift({word:expected[i-1],heard:heard[j-1],status:correct?'correct':'needs_practice',practiceSyllables:correct?[]:syllables(expected[i-1]).slice(0,3)});i--;j--;
  }else if(i&&table[i][j]===table[i-1][j]+1){words.unshift({word:expected[i-1],heard:null,status:'missing',practiceSyllables:syllables(expected[i-1]).slice(0,3)});i--;}
  else{extraWords.unshift(heard[j-1]);j--;}
 }
 const accuracy=a.length?Math.max(0,Math.min(100,Math.round(100*earned/Math.max(a.length,b.length)))):0;
 const band=accuracy===100?'perfect':accuracy>=80?'correct':accuracy>=70?'close':'needs_practice';
 const message=accuracy>=80?'Magaling! Malinaw ang iyong pagbasa.':accuracy>=70?'Malapit na! Pakinggan muli bago subukang bumasa.':'Subukan muli nang dahan-dahan. Basahin ang bawat pantig.';
 return {accuracy,correct:accuracy>=80,band,message,words,extraWords,note:'Batay sa nakilalang teksto ang paghahambing. Ang mga pantig ay mungkahing pagsasanay, hindi pagsusuri ng mismong tunog.'};
}
module.exports={readingFeedback,tokenize,normalize,syllables};
