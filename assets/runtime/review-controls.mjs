/** Review retirement is separate from immutable quiz evidence. */
export function wireRetirement({ button, status, classroom, item, saved }) {
  let busy = false;
  button.textContent = item.retiredAt === undefined ? "Retire item" : "Restore item";
  button.onclick = async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const response = await fetch("/api/review/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classroom,
          key: item.key,
          retired: item.retiredAt === undefined,
          revision: item.revision,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || `Review action returned ${response.status}.`);
      if (!result.item) throw new Error("Review action returned no saved item.");
      item = result.item;
      status.textContent =
        item.retiredAt === undefined
          ? "Item restored to active reviews."
          : "Item retired. Its saved answers and grades remain in history. This published review stays available.";
      button.textContent = item.retiredAt === undefined ? "Retire item" : "Restore item";
      saved?.(item);
    } catch (error) {
      status.textContent = error.message;
      button.textContent = "Retry item action";
    } finally {
      busy = false;
      button.disabled = false;
    }
  };
}
