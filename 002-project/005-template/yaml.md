<%*
const date = tp.date.now("YYYY-MM-DD[T]HH:mm:ss+08:00");

tR += `---
title: "${tp.file.cursor(1)}"
date: ${date}
tags: ${tp.file.cursor(0)}
description: ${tp.file.cursor(3)}
---

# ${tp.file.cursor(1)}

${tp.file.cursor(2)}
`;
-%>
