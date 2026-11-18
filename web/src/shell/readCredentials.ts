// Safari AutoFill (suggestion, or right-click / long-press > AutoFill) fills fields without
// key events, so React state can lag or be overwritten (#511). Read the form itself on submit.
export function readCredentials(form: HTMLFormElement): { username: string; password: string } {
  const data = new FormData(form);
  return { username: String(data.get("username") ?? ""), password: String(data.get("password") ?? "") };
}
