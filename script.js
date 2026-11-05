document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW fail:', err));
    }

    const tape = document.getElementById('roulette-tape');
    const btn = document.getElementById('spin-btn');
    const overlay = document.getElementById('overlay');
    const closeBtn = document.getElementById('close-btn');
    const resultImg = document.getElementById('result-image');
    const resultName = document.getElementById('result-name');
    
    const ITEM_HEIGHT = 150;
    
    const urlParams = new URLSearchParams(window.location.search);
    const isIPadMode = window.matchMedia('(display-mode: standalone)').matches || urlParams.has('ipad');
    const userChatId = urlParams.get('chat_id'); 

    // ВСТАВЬТЕ СЮДА ТОКЕН ВАШЕГО БОТА
    const TELEGRAM_BOT_TOKEN = 'ВАШ_ТОКЕН_БОТА_ОТ_BOTFATHER'; 

    let prizes = [];
    
    const localStock = localStorage.getItem('localPrizes');
    if (localStock) {
        prizes = JSON.parse(localStock);
    } else {
        try {
            const res = await fetch('prizes.json');
            prizes = await res.json();
            localStorage.setItem('localPrizes', JSON.stringify(prizes));
        } catch (error) {
            console.error('Ошибка загрузки', error);
            return;
        }
    }

    const tapeLength = 5;
    let fullList = [];
    for(let i=0; i < tapeLength; i++) fullList = fullList.concat(prizes);
    
    function renderTape() {
        tape.innerHTML = '';
        fullList.forEach(prize => {
            const div = document.createElement('div');
            div.className = 'prize-item';
            div.innerHTML = `<img src="${prize.image}" alt="${prize.name}"><p>${prize.name}</p>`;
            tape.appendChild(div);
        });
    }
    renderTape();

    function showWinner(winner) {
        resultImg.src = winner.image;
        resultName.innerText = winner.name;
        overlay.classList.add('active');
        btn.classList.add('hidden');
    }

    if (!isIPadMode) {
        const savedWinId = localStorage.getItem('wonPrizeId');
        if (savedWinId) {
            const savedWinner = prizes.find(p => p.id === savedWinId);
            if (savedWinner) showWinner(savedWinner);
        }
    }

    if (isIPadMode) closeBtn.classList.add('visible');

    async function notifyTelegramBot(prizeName) {
        if (!userChatId || TELEGRAM_BOT_TOKEN === 'ВАШ_ТОКЕН_БОТА_ОТ_BOTFATHER') return;
        const message = `Поздравляем! Ваш приз: ${prizeName}. Подойдите на стойку Midea | Linvol, чтобы его получить.`;
        
        try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: userChatId, text: message })
            });
        } catch (err) {
            console.error('Ошибка TG:', err);
        }
    }

    function saveOfflineSpin(prizeId) {
        let queue = JSON.parse(localStorage.getItem('syncQueue')) || [];
        queue.push({ id: prizeId, timestamp: Date.now() });
        localStorage.setItem('syncQueue', JSON.stringify(queue));
        
        const prizeToUpdate = prizes.find(p => p.id === prizeId);
        if(prizeToUpdate) prizeToUpdate.amount -= 1;
        localStorage.setItem('localPrizes', JSON.stringify(prizes));
    }

    async function syncWithServer() {
        if (!navigator.onLine) return;
        let queue = JSON.parse(localStorage.getItem('syncQueue')) || [];
        if (queue.length === 0) return;
        try {
            // await fetch('https://your-server.com/api/sync', { ... });
            console.log('Синхронизация успешна!', queue.length);
            localStorage.removeItem('syncQueue');
        } catch (err) {}
    }
    window.addEventListener('online', syncWithServer);

    function getWinnerIndex() {
        const available = prizes.filter(p => p.amount > 0);
        if (available.length === 0) return 0;
        
        const totalWeight = available.reduce((sum, p) => sum + (p.amount * p.weight), 0);
        let randomValue = Math.random() * totalWeight;

        for (let i = 0; i < available.length; i++) {
            randomValue -= (available[i].amount * available[i].weight);
            if (randomValue <= 0) return prizes.findIndex(p => p.id === available[i].id);
        }
        return 0;
    }

    btn.addEventListener('click', () => {
        btn.classList.add('hidden');
        const winnerIndex = getWinnerIndex();
        const winner = prizes[winnerIndex];
        
        if (!isIPadMode) localStorage.setItem('wonPrizeId', winner.id);

        saveOfflineSpin(winner.id);
        syncWithServer();

        const winningElementIndex = (prizes.length * (tapeLength - 1)) + winnerIndex;
        const offset = (winningElementIndex * ITEM_HEIGHT) - (150 / 2) + (ITEM_HEIGHT / 2);
        const randomOffset = Math.floor(Math.random() * 40) - 20;

        tape.style.transform = `translateY(-${offset + randomOffset}px)`;

        setTimeout(() => {
            showWinner(winner);
            if (!isIPadMode) notifyTelegramBot(winner.name);
        }, 4200); 
    });

    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('active');
        btn.classList.remove('hidden');
        tape.style.transition = 'none';
        tape.style.transform = 'translateY(0px)';
        setTimeout(() => {
            tape.style.transition = 'transform 4s cubic-bezier(0.15, 0.85, 0.2, 1)';
        }, 50);
    });
});