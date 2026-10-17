const userGuideKey='hornet.userGuide.seen';
export function showFirstRunGuide(){try{return localStorage.getItem(userGuideKey)!=='1';}catch{return true;}}
export function acknowledgeUserGuide(){try{localStorage.setItem(userGuideKey,'1');}catch{/* Keep the guide usable if preference storage is unavailable. */}}
