document.addEventListener('DOMContentLoaded', function() {
  // 创建切换按钮
  const btn = document.createElement('button');
  btn.id = 'toggle-blanks';
  btn.innerHTML = '切换挖空';
  btn.style.position = 'fixed';
  btn.style.bottom = '20px';
  btn.style.right = '20px';
  btn.style.zIndex = '1000';
  btn.style.padding = '8px 16px';
  btn.style.borderRadius = '20px';
  btn.style.backgroundColor = 'var(--md-primary-fg-color)';
  btn.style.color = 'white';
  btn.style.border = 'none';
  btn.style.cursor = 'pointer';
  
  // 添加点击事件
  btn.addEventListener('click', function() {
    const blanks = document.querySelectorAll('.md-typeset u');
    const isActive = document.body.classList.toggle('blanks-active');
    
    // 保存用户偏好
    localStorage.setItem('blanksActive', isActive);
    
    // 切换所有挖空元素
    blanks.forEach(u => {
      isActive ? u.classList.remove('active') : u.classList.add('active');
    });
  });

  // 初始化状态
  if(localStorage.getItem('blanksActive') === 'true') {
    document.body.classList.add('blanks-active');
    document.querySelectorAll('.md-typeset u').forEach(u => {
      u.classList.remove('active');
    });
  }

  document.body.appendChild(btn);
});