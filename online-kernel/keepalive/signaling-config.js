import {saveConfigValue} from './transfer-limit-config.js';

export const DEFAULT_SIGNALING_URL='wss://broker.emqx.io:8084/mqtt';
export function normalizeSignalingUrl(value){
 if(typeof value!=='string')throw Error('信令服务器地址必须是字符串');
 const normalized=value.trim();
 if(!normalized)return DEFAULT_SIGNALING_URL;
 if(normalized.length>200)throw Error('信令服务器地址不能超过 200 个字符');
 if(normalized.includes('#'))throw Error('信令服务器地址不能包含 # 片段');
 if(!/^wss?:\/\//i.test(normalized)||/[\x00-\x20\x7f]/.test(normalized))throw Error('信令服务器地址必须是有效的 ws:// 或 wss:// URL');
 let parsed;try{parsed=new URL(normalized);}catch{throw Error('信令服务器地址必须是有效的 ws:// 或 wss:// URL');}
 if(!['ws:','wss:'].includes(parsed.protocol)||!parsed.hostname)throw Error('信令服务器地址必须是有效的 ws:// 或 wss:// URL');
 return normalized;
}
export async function saveSignalingUrl({profile,value,indexedDB,storage,isCurrent,timeoutMs}={}){
 return await saveConfigValue({profile,indexedDB,storage,isCurrent,timeoutMs,key:'nnk_mqttUrl',value:normalizeSignalingUrl(value)});
}
