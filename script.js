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
    
    const windowEl = document.querySelector('.roulette-window');

    // ===== Настройки анимации (можно менять) =====
    const IDLE_SPEED  = 0.3;  // призов в секунду, когда лента просто медленно крутится
    const MAX_SPEED   = 9;    // призов в секунду на пике вращения
    const ACCEL_TIME  = 2.5;  // секунд: плавный разгон
    const CRUISE_TIME = 0.6;  // секунд: вращение на полной скорости
    const DECEL_TIME  = 3.5;  // секунд: плавное торможение (минимум, точное время подбирается под приз)

    // Размеры считаются из реального размера окна: один приз = высота окна
    let WINDOW_HEIGHT = 300;
    let ITEM_HEIGHT = 300;
    let START_OFFSET = 0;

    let prizes = [];
    let pos = 0;          // сколько пикселей ленты прокручено
    let speed = 0;        // текущая скорость, px/сек
    let mode = 'idle';    // 'idle' (медленно крутится) | 'spin' (розыгрыш) | 'stopped' (показан приз)
    let spin = null;
    let lastTs = null;

    const smooth = u => 3 * u * u - 2 * u * u * u;                  // плавная S-кривая
    const smoothInt = u => u * u * u - (u * u * u * u) / 2;         // её интеграл (пройденный путь)

    function updateSizes() {
        const oldH = ITEM_HEIGHT;
        WINDOW_HEIGHT = windowEl.clientHeight;
        ITEM_HEIGHT = WINDOW_HEIGHT;
        START_OFFSET = (WINDOW_HEIGHT - ITEM_HEIGHT) / 2;
        document.documentElement.style.setProperty('--item-h', ITEM_HEIGHT + 'px');
        if (oldH && oldH !== ITEM_HEIGHT) {
            pos = pos / oldH * ITEM_HEIGHT;
            speed = speed / oldH * ITEM_HEIGHT;
        }
    }

    function renderTape() {
        const cycle = prizes.length * ITEM_HEIGHT;
        if (!cycle) return;
        const m = ((pos % cycle) + cycle) % cycle;
        tape.style.transform = `translate3d(0, ${START_OFFSET - m}px, 0)`;
    }

    function spinPosition(e) {
        const { p0, vS, vM, Ta, Tc, Td, Da, Dc, total } = spin;
        if (e < Ta) return p0 + vS * e + (vM - vS) * Ta * smoothInt(e / Ta);
        if (e < Ta + Tc) return p0 + Da + vM * (e - Ta);
        if (e < Ta + Tc + Td) {
            const u = (e - Ta - Tc) / Td;
            return p0 + Da + Dc + vM * Td * (u - smoothInt(u));
        }
        return p0 + total;
    }

    function tick(ts) {
        if (lastTs === null) lastTs = ts;
        const dt = Math.min((ts - lastTs) / 1000, 0.1);
        lastTs = ts;

        if (mode === 'idle') {
            const target = IDLE_SPEED * ITEM_HEIGHT;
            speed += (target - speed) * Math.min(1, dt * 1.5);   // мягкий выход на скорость ожидания
            pos += speed * dt;
        } else if (mode === 'spin') {
            spin.e += dt;
            pos = spinPosition(spin.e);
            if (spin.e >= spin.Ta + spin.Tc + spin.Td) {
                pos = spin.p0 + spin.total;
                speed = 0;
                mode = 'stopped';
                const done = spin.onDone;
                spin = null;
                setTimeout(done, 500);
            }
        }
        renderTape();
        requestAnimationFrame(tick);
    }

    function startSpin(winnerIndex, onDone) {
        updateSizes();
        const H = ITEM_HEIGHT;
        const cycle = prizes.length * H;
        const vM = MAX_SPEED * H;
        const vS = speed;
        const Ta = ACCEL_TIME, Tc = CRUISE_TIME;
        const Da = Ta * (vS + vM) / 2;                 // путь за время разгона
        const Dc = vM * Tc;                            // путь на полной скорости
        const base = Da + Dc + vM * DECEL_TIME / 2;    // путь с минимальным торможением
        // добавляем нужный "хвост", чтобы остановиться ровно на выигранном призе
        const need = ((((winnerIndex * H) - (pos + base)) % cycle) + cycle) % cycle;
        const total = base + need;
        const Td = 2 * (total - Da - Dc) / vM;         // итоговое время торможения
        spin = { p0: pos, vS, vM, Ta, Tc, Td, Da, Dc, total, e: 0, onDone };
        mode = 'spin';
    }

    function relayout() {
        if (mode === 'spin') return;
        updateSizes();
        renderTape();
    }
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', () => setTimeout(relayout, 200));
    
    const urlParams = new URLSearchParams(window.location.search);
    const isIPadMode = window.matchMedia('(display-mode: standalone)').matches || urlParams.has('ipad');
    const userChatId = urlParams.get('chat_id'); 

    // ВСТАВЬТЕ СЮДА ТОКЕН ВАШЕГО БОТА
    const TELEGRAM_BOT_TOKEN = 'ВАШ_ТОКЕН_БОТА_ОТ_BOTFATHER';

    // Меняйте это значение при каждом изменении prizes.json — тогда у всех устройств
    // сбросится старый остаток и подтянется новый список призов.
    const PRIZES_VERSION = '3';

    if (localStorage.getItem('prizesVersion') !== PRIZES_VERSION) {
        localStorage.removeItem('localPrizes');
        localStorage.removeItem('wonPrizeId');
        localStorage.setItem('prizesVersion', PRIZES_VERSION);
    }

    const localStock = localStorage.getItem('localPrizes');
    if (localStock) {
        prizes = JSON.parse(localStock);
    } else {
        try {
            const res = await fetch('prizes.json', { cache: 'no-cache' });
            prizes = await res.json();
            // Запоминаем стартовое количество: шанс приза считается от него и не меняется по мере раздачи
            prizes.forEach(p => { p.initialAmount = p.amount; });
            localStorage.setItem('localPrizes', JSON.stringify(prizes));
        } catch (error) {
            console.error('Ошибка загрузки', error);
            return;
        }
    }

    // Лента: 3 копии списка призов — этого хватает для бесшовного бесконечного цикла
    let fullList = [];
    for (let i = 0; i < 3; i++) fullList = fullList.concat(prizes);

    tape.innerHTML = '';
    fullList.forEach(prize => {
        const div = document.createElement('div');
        div.className = 'prize-item';
        div.innerHTML = `<img src="${prize.image}" alt="${prize.name}"><p>${prize.name}</p>`;
        tape.appendChild(div);
    });
    updateSizes();
    renderTape();
    requestAnimationFrame(tick);

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
        
        // Шанс = стартовое количество × вес. Он постоянный: когда блокноты убывают,
        // шансы редких призов НЕ растут. Закончившийся приз просто исключается.
        const chance = p => (p.initialAmount ?? p.amount) * p.weight;
        const totalWeight = available.reduce((sum, p) => sum + chance(p), 0);
        let randomValue = Math.random() * totalWeight;

        for (let i = 0; i < available.length; i++) {
            randomValue -= chance(available[i]);
            if (randomValue <= 0) return prizes.findIndex(p => p.id === available[i].id);
        }
        return 0;
    }

    btn.addEventListener('click', () => {
        if (mode !== 'idle') return;
        btn.classList.add('hidden');
        const winnerIndex = getWinnerIndex();
        const winner = prizes[winnerIndex];

        if (!isIPadMode) localStorage.setItem('wonPrizeId', winner.id);

        saveOfflineSpin(winner.id);
        syncWithServer();

        startSpin(winnerIndex, () => {
            showWinner(winner);
            if (!isIPadMode) notifyTelegramBot(winner.name);
        });
    });

    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('active');
        btn.classList.remove('hidden');
        mode = 'idle';   // лента снова плавно начинает медленно крутиться
    });
});
