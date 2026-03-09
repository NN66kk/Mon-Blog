<%*
const title = tp.file.title.replace(/_\d{8,14}$/, "");
const date = tp.date.now("YYYY-MM-DD[T]HH:mm:ss+08:00");

tR += `---
title: "${title}"
date: ${date}
tags: ${tp.file.cursor(0)}
---

# ${title}

${tp.file.cursor(1)}
`;
-%>
