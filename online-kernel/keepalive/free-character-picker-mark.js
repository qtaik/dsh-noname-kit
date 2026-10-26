import {FREE_CHOICE_MODES} from './free-character-options.js';

const field='nnkFreeCharacterPicker';
function sentinel(mode){return FREE_CHOICE_MODES.includes(mode)?'nnk-free-character-picker:v1:'+mode:null;}

// Native chooseButton ignores unknown string arguments while preserving _args.
// Its single-object overload must remain a single object on remote dispatch.
export function markFreeCharacterPickerRow(row,mode){
  const value=sentinel(mode);if(!value||!Array.isArray(row)||row.length<2)return false;
  if(row.length===2&&row[1]&&typeof row[1]==='object'&&!Array.isArray(row[1])){
    if(row[1][field]!==value)row[1]={...row[1],[field]:value};
  }else if(!row.slice(1).includes(value))row.push(value);
  return true;
}

export function markFreeCharacterPickerEvent(event,mode){
  const value=sentinel(mode);if(!value||!event)return false;
  if(event[field]!==value){if(typeof event.set==='function')event.set(field,value);else event[field]=value;}
  return true;
}

export function hasFreeCharacterPickerMark(event,mode){
  const value=sentinel(mode);if(!value||!event)return false;
  return event[field]===value||Array.isArray(event._args)&&event._args.includes(value);
}

export function hasFreeCharacterPickerMetadata(event){
  return !!event&&(Object.prototype.hasOwnProperty.call(event,field)||Array.isArray(event._args)&&event._args.some(value=>typeof value==='string'&&value.startsWith('nnk-free-character-picker:')));
}
