module.exports = async (params) => {
  const { app } = params;

  const file = app.workspace.getActiveFile();
  if (!file) {
    new Notice("没有检测到当前活动笔记");
    return;
  }

  const content = await app.vault.read(file);

  function formatDateToUTC8(date = new Date()) {
    const utc = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
    const utc8 = new Date(utc + 8 * 60 * 60 * 1000);

    const Y = utc8.getFullYear();
    const M = String(utc8.getMonth() + 1).padStart(2, "0");
    const D = String(utc8.getDate()).padStart(2, "0");
    const h = String(utc8.getHours()).padStart(2, "0");
    const m = String(utc8.getMinutes()).padStart(2, "0");
    const s = String(utc8.getSeconds()).padStart(2, "0");

    return `${Y}-${M}-${D}T${h}:${m}:${s}+08:00`;
  }

  const newDate = formatDateToUTC8();

  let newContent = content;

  if (content.startsWith("---\n")) {
    const endIndex = content.indexOf("\n---", 4);

    if (endIndex !== -1) {
      const frontmatter = content.slice(4, endIndex);
      const body = content.slice(endIndex + 4);

      let updatedFrontmatter;

      if (/^date\s*:/m.test(frontmatter)) {
        updatedFrontmatter = frontmatter.replace(
          /^date\s*:\s*.*$/m,
          `date: ${newDate}`
        );
      } else {
        updatedFrontmatter = `${frontmatter}\ndate: ${newDate}`;
      }

      newContent = `---\n${updatedFrontmatter}\n---${body}`;
    } else {
      newContent = `---\ndate: ${newDate}\n---\n${content}`;
    }
  } else {
    newContent = `---\ndate: ${newDate}\n---\n${content}`;
  }

  await app.vault.modify(file, newContent);
  new Notice(`已更新 date 字段为：${newDate}`);
};