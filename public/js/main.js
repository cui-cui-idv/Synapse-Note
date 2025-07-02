document.addEventListener('DOMContentLoaded', function() {
    const hamburgerButton = document.querySelector('.hamburger-menu');
    const header = document.querySelector('header');

    // ハンバーガーボタンとヘッダーが存在する場合のみ実行
    if (hamburgerButton && header) {
        hamburgerButton.addEventListener('click', function() {
            // header要素に 'mobile-menu-open' クラスを付けたり外したりする
            header.classList.toggle('mobile-menu-open');
        });
    }
});