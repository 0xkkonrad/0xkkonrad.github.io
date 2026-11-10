let deferredPrompt=null;
let registration=null;
export async function setupPWA({names=['Goblin','Gremlin'],onInstallReady=()=>{},onUpdateReady=()=>{}}={}) {
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;onInstallReady();});
  addEventListener('appinstalled',()=>{deferredPrompt=null;});
  const updateNames=async names=>{
    if (!('serviceWorker' in navigator)) return;
    const reg=await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
    reg?.active?.postMessage({type:'PLAYER_NAMES',names});
  };
  const applyUpdate=worker=>()=>{
    navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
    worker?.postMessage({type:'ACTIVATE'});
  };
  if ('serviceWorker' in navigator) {
    try {
      registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      await updateNames(names);
      if(registration.waiting)onUpdateReady(applyUpdate(registration.waiting));
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        worker?.addEventListener('statechange',()=>{
          if(worker.state==='installed' && navigator.serviceWorker.controller)onUpdateReady(applyUpdate(worker));
        });
      });
    }catch(error){console.warn('Offline setup unavailable:',error.message);}
  }
  return {updateNames,canInstall:()=>!!deferredPrompt,async install(){
    if(!deferredPrompt)return false;
    const prompt=deferredPrompt;deferredPrompt=null;
    await prompt.prompt();return (await prompt.userChoice).outcome==='accepted';
  }};
}
