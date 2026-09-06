import { useEffect, useState } from "react";
import type { NeuraGateway, NeuraQuestion } from "./openclaw";

export function NeuraQuestions({ gateway, sessionKey, notify }: { gateway: NeuraGateway; sessionKey: string; notify: (message: string) => void }) {
  const [questions, setQuestions] = useState<NeuraQuestion[]>([]);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const pending = await gateway.listQuestions(sessionKey);
        if (active && current === revision) setQuestions(pending);
      } catch (error) {
        if (active && current === revision) notify(error instanceof Error ? error.message : "Could not load Neura’s questions.");
      }
    };
    void refresh();
    const unsubscribe = gateway.onEvent((event) => {
      if (event.event === "question.requested" || event.event === "question.resolved") void refresh();
    });
    return () => { active = false; unsubscribe(); };
  }, [gateway, sessionKey, notify]);
  return <>{questions.map((question) => <QuestionCard key={question.id} question={question} gateway={gateway} onResolved={() => setQuestions((current) => current.filter((row) => row.id !== question.id))} notify={notify} />)}</>;
}

function QuestionCard({ question, gateway, onResolved, notify }: { question: NeuraQuestion; gateway: NeuraGateway; onResolved: () => void; notify: (message: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, question.expiresAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [question.expiresAtMs]);
  const response = Object.fromEntries(question.questions.map((item) => [item.questionId,
    freeText[item.questionId]?.trim() ? [freeText[item.questionId].trim()] : answers[item.questionId] ?? [],
  ]));
  const ready = Object.values(response).every((values) => values.length > 0);
  const resolve = async (cancel = false) => {
    if (busy || expired || !cancel && !ready) return;
    setBusy(true);
    try { await gateway.resolveQuestion(question.id, cancel ? null : response); onResolved(); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not answer Neura’s question."); }
    finally { setBusy(false); }
  };
  return <form className="neura-questions" aria-label="Questions from Neura" onSubmit={(event) => { event.preventDefault(); void resolve(); }}>
    {question.questions.map((item) => <fieldset key={item.questionId} disabled={busy || expired}>
      <legend>{item.question}</legend>
      {item.options.map((option) => <label className="neura-question-option" key={option.label}>
        <input type={item.multiSelect ? "checkbox" : "radio"} name={`${question.id}:${item.questionId}`} checked={!freeText[item.questionId] && (answers[item.questionId] ?? []).includes(option.label)} onChange={(event) => {
          setFreeText((current) => ({ ...current, [item.questionId]: "" }));
          setAnswers((current) => ({ ...current, [item.questionId]: item.multiSelect
            ? event.target.checked ? [...(current[item.questionId] ?? []), option.label] : (current[item.questionId] ?? []).filter((value) => value !== option.label)
            : [option.label] }));
        }} />
        <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}
      {item.isOther && <label className="neura-question-freeform"><span>{item.options.length ? "Your own answer" : "Your answer"}</span><input type={item.isSecret ? "password" : "text"} value={freeText[item.questionId] ?? ""} onChange={(event) => setFreeText((current) => ({ ...current, [item.questionId]: event.target.value }))} /></label>}
    </fieldset>)}
    <footer>{expired ? <span role="status">This question has expired.</span> : <><button type="button" disabled={busy} onClick={() => void resolve(true)}>Cancel</button><button type="submit" disabled={busy || !ready}>{busy ? "Sending…" : "Submit answers"}</button></>}</footer>
  </form>;
}
