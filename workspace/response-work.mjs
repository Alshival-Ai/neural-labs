// A client disconnect does not cancel asynchronous filesystem/provider work.
// Keep admission busy until both the handler and the response have settled.
export function trackResponseWork(response, work, activity) {
  activity(1);
  let handlerDone = false, responseDone = false, released = false;
  const release = () => {
    if (!released && handlerDone && responseDone) { released = true; activity(-1); }
  };
  const ended = () => { responseDone = true; release(); };
  response.once("finish", ended); response.once("close", ended);
  return Promise.resolve().then(work).finally(() => { handlerDone = true; release(); });
}
