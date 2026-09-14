export function buildReel(prizes, code) {
  const winner=prizes.find(p=>p.code===code);
  if(!winner || !prizes.length)throw new Error('Неизвестный приз');
  const index=56;
  const items=Array.from({length:index+5},(_,i)=>prizes[i%prizes.length]);
  items[index]=winner;
  return {items,index};
}

export function createSpinController(send, storage) {
  let pending=null, key=storage.loadKey();
  return {
    get busy(){return pending!==null;},
    get recovering(){return Boolean(key);},
    acknowledge(){storage.clearKey();key=null;},
    spin(){
      if(pending)return pending;
      key ||= storage.newKey();
      storage.saveKey(key);
      pending=(async()=>{
        try {
          const result=await send(key);
          return result;
        } catch(error) {
          if(error.retryable===false){storage.clearKey();key=null;}
          throw error;
        } finally {pending=null;}
      })();
      return pending;
    }
  };
}

export async function animateReel(strip, viewport, prizes, result, render) {
  const {items,index}=buildReel(prizes,result.code);
  strip.innerHTML=items.map(render).join('');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cells=strip.children;
  const center=i=>viewport.clientWidth/2-(cells[i].offsetLeft+cells[i].offsetWidth/2);
  const start=center(1), end=center(index);
  strip.style.transform=`translateX(${end}px)`;
  if(!reduced && strip.animate){
    const animation=strip.animate([
      {transform:`translateX(${start}px)`},
      {transform:`translateX(${end}px)`}
    ],{duration:4400,easing:'cubic-bezier(.12,.72,.12,1)'});
    let timer;
    try {
      await Promise.race([animation.finished.catch(()=>{}),new Promise(resolve=>timer=setTimeout(resolve,5000))]);
    } finally {clearTimeout(timer);animation.cancel();}
  }
  // Recompute after animation in case the viewport rotated during the spin.
  strip.style.transform=`translateX(${center(index)}px)`;
  cells[index].classList.add('winner');
  if(window.ResizeObserver){
    const observer=new ResizeObserver(()=>{
      if(!cells[index]?.isConnected){observer.disconnect();return;}
      strip.style.transform=`translateX(${center(index)}px)`;
    });
    observer.observe(viewport);
  }
}
