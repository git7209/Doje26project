import { useEffect, useRef, useState } from "react";
import { createAccount, loginAccount, logoutAccount } from "../api/dockerApi.js";

function AuthDialog({ open, user, onClose, onAuthenticated, onLoggedOut }) {
  const dialogRef = useRef(null);
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setForm({ name: "", email: "", password: "", confirmPassword: "" });
  }

  async function submit(event) {
    event.preventDefault();
    if (mode === "signup" && form.password !== form.confirmPassword) {
      setError("비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const result = mode === "signup"
        ? await createAccount({ name: form.name, email: form.email, password: form.password })
        : await loginAccount({ email: form.email, password: form.password });
      onAuthenticated(result.user);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    setWorking(true);
    setError("");
    try {
      await logoutAccount();
      onLoggedOut();
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  return <dialog className="auth-dialog" ref={dialogRef} onCancel={onClose} onClose={onClose}>
    <article className="dialog-card auth-card">
      <header>
        <div><h2>{user ? "계정" : mode === "login" ? "로그인" : "계정 만들기"}</h2><p>{user ? "현재 로그인한 계정입니다." : "LXC Console 계정으로 계속하세요."}</p></div>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="닫기">×</button>
      </header>
      {user ? <div className="auth-account">
        <span>{user.name.slice(0, 2).toUpperCase()}</span>
        <strong>{user.name}</strong>
        <small>{user.email}</small>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="auth-logout" type="button" onClick={logout} disabled={working}>{working ? "처리 중..." : "로그아웃"}</button>
      </div> : <form onSubmit={submit}>
        {mode === "signup" && <div className="form-field"><label htmlFor="auth-name">이름</label><input id="auth-name" name="name" value={form.name} onChange={update} minLength="2" maxLength="40" autoComplete="name" autoFocus required /></div>}
        <div className="form-field"><label htmlFor="auth-email">이메일</label><input id="auth-email" name="email" type="email" value={form.email} onChange={update} maxLength="254" autoComplete="email" autoFocus={mode === "login"} required /></div>
        <div className="form-field"><label htmlFor="auth-password">비밀번호</label><input id="auth-password" name="password" type="password" value={form.password} onChange={update} minLength="8" maxLength="128" autoComplete={mode === "login" ? "current-password" : "new-password"} required /><small>8자 이상 입력하세요.</small></div>
        {mode === "signup" && <div className="form-field"><label htmlFor="auth-confirm-password">비밀번호 확인</label><input id="auth-confirm-password" name="confirmPassword" type="password" value={form.confirmPassword} onChange={update} minLength="8" maxLength="128" autoComplete="new-password" required /></div>}
        {error && <p className="form-error auth-error" role="alert">{error}</p>}
        <div className="auth-actions">
          <button className="primary" type="submit" disabled={working}>{working ? "처리 중..." : mode === "login" ? "로그인" : "계정 만들기"}</button>
          <span>{mode === "login" ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"}</span>
          <button className="auth-switch" type="button" onClick={() => changeMode(mode === "login" ? "signup" : "login")} disabled={working}>{mode === "login" ? "계정 만들기" : "로그인으로 돌아가기"}</button>
        </div>
      </form>}
    </article>
  </dialog>;
}

export default function AppHeader({ user, authChecking, notifications = [], onOpenNotifications, onOpenDocs, onAuthenticated, onLoggedOut, onOpenAuth }) {
  const [authOpen, setAuthOpen] = useState(false);

  function openAuth() {
    onOpenAuth();
    setAuthOpen(true);
  }

  return (
    <header className="app-header">
      <label className="global-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" placeholder="컨테이너, 이미지, 볼륨 검색" aria-label="리소스 검색" />
        <kbd>Ctrl K</kbd>
      </label>
      <button className="login-button" type="button" onClick={openAuth} disabled={authChecking}>{authChecking ? "확인 중" : user ? user.name : "로그인"}</button>
      <button className="icon-button" type="button" onClick={onOpenDocs} aria-label="문서 열기">?</button>
      <button className="icon-button header-action" type="button" onClick={onOpenNotifications} aria-label="알림">
        ♢{notifications.length > 0 && <b className="header-badge">{Math.min(notifications.length, 99)}</b>}
      </button>
      <AuthDialog open={authOpen} user={user} onClose={() => setAuthOpen(false)} onAuthenticated={onAuthenticated} onLoggedOut={onLoggedOut} />
    </header>
  );
}

