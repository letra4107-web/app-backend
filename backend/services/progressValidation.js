const {UUID}=require('./progressEvents');
module.exports={isUuid:value=>typeof value==='string'&&UUID.test(value),isBoundedString:(v,max,{allowEmpty=true}={})=>typeof v==='string'&&v.length<=max&&(allowEmpty||v.trim().length>0)};
