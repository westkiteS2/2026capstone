window.PwUtils = (() => {
  function debounce(fn, delay = 400) {
    let timer = null;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function getSiteName() {
    const host = window.location.hostname || "";
    return host.replace(/^www\./, "").split(".")[0] || "";
  }

  function isVisibleElement(el) {
    if (!el) return false;

    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    return !(
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      rect.width <= 0 ||
      rect.height <= 0
    );
  }

  function isPasswordInput(el) {
    return (
      el &&
      el.tagName === "INPUT" &&
      el.type === "password" &&
      isVisibleElement(el)
    );
  }

  async function sha1Hex(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  return {
    debounce,
    getSiteName,
    isVisibleElement,
    isPasswordInput,
    sha1Hex,
  };
})();
