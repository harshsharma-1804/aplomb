/** Navigation must wait for every save; a rejected save keeps the draft open. */
export async function saveBeforeLeaving(entries: {save:()=>Promise<void>}[], leave:()=>void) {
  for (const entry of entries) await entry.save();
  leave();
}
