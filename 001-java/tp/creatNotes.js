module.exports = async (params) => {
  const { app } = params;

  function getUUID() {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const MM = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${yy}${MM}${dd}${hh}${mm}${ss}`;
  }

  const uuid = getUUID();

  // 改成你真正要创建笔记的目录
  const targetFolder = "";

  const newFilePath = targetFolder
    ? `${targetFolder}/${uuid}.md`
    : `${uuid}.md`;

  try {
    const newFile = await app.vault.create(newFilePath, "");
    await app.workspace.getLeaf(true).openFile(newFile);
    new Notice(`已创建文件：${uuid}.md`);
  } catch (error) {
    console.error(error);
    new Notice(`创建失败：${error.message}`);
  }
};