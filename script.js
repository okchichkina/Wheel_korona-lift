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
        const items = tape.children;
        const n = items.length;
        if (!n) return;
        const H = ITEM_HEIGHT;
        const cycle = n * H;
        const dpr = window.devicePixelRatio || 1;
        for (let i = 0; i < n; i++) {
            // позиция приза i с «зацикливанием»: уезжает вверх и появляется снизу
            let y = n === 1 ? 0 : ((((i * H - pos) + H) % cycle) + cycle) % cycle - H;
            y += START_OFFSET;
            // округляем до физических пикселей экрана: убирает мерцание и «рябь» на дробных координатах
            y = Math.round(y * dpr) / dpr;
            const el = items[i];
            el.style.transform = `translate3d(0, ${y}px, 0)`;
            el.style.visibility = (y > -H && y < WINDOW_HEIGHT) ? 'visible' : 'hidden';
        }
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
    const PRIZES_VERSION = '6';

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

    // Лента: по одному элементу на приз. Каждый двигается отдельно и «зацикливается» в renderTape()
    tape.innerHTML = '';
    prizes.forEach(prize => {
        const div = document.createElement('div');
        div.className = 'prize-item';
        div.innerHTML = `<img src="${prize.image}" alt="" decoding="async">`;
        tape.appendChild(div);
    });
    updateSizes();
    renderTape();

    // Ждём, пока картинки загрузятся и декодируются, чтобы анимация не «спотыкалась»
    await Promise.all([...tape.querySelectorAll('img')].map(img =>
        (img.decode ? img.decode() : Promise.resolve()).catch(() => {})
    ));
    requestAnimationFrame(tick);

    // ===== Конфетти при показе выигрыша =====
    const confettiCanvas = document.getElementById('confetti');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let confettiFrame = null;
    let confettiTimer = null;

    function stopConfetti() {
        clearTimeout(confettiTimer);
        if (confettiFrame) cancelAnimationFrame(confettiFrame);
        confettiFrame = null;
        const ctx = confettiCanvas.getContext('2d');
        ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }

    function launchConfetti() {
        if (reduceMotion) return;
        stopConfetti();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = confettiCanvas.width = Math.round(window.innerWidth * dpr);
        const H = confettiCanvas.height = Math.round(window.innerHeight * dpr);
        const ctx = confettiCanvas.getContext('2d');
        const colors = ['#FF4C00', '#FF7033', '#1E150D', '#F3E6C8', '#FF8D5C', '#FFFFFF'];
        const rand = (min, max) => min + Math.random() * (max - min);
        const parts = [];

        // пушка: n частиц из точки (x, y), направление angle (рад), разброс spread
        function cannon(x, y, n, angle, spread, vMin, vMax) {
            for (let i = 0; i < n; i++) {
                const a = angle + rand(-spread, spread);
                const v = rand(vMin, vMax) * dpr;
                parts.push({
                    x, y,
                    vx: Math.cos(a) * v,
                    vy: Math.sin(a) * v,
                    size: rand(6, 12) * dpr,
                    rot: rand(0, Math.PI * 2),
                    vr: rand(-8, 8),
                    flip: rand(0, Math.PI * 2),
                    vf: rand(4, 10),
                    color: colors[Math.floor(Math.random() * colors.length)],
                    round: Math.random() < 0.25,
                    life: rand(2.6, 4.2),
                    age: 0
                });
            }
        }

        // два выстрела снизу слева и справа внутрь + россыпь сверху
        const up = -Math.PI / 2;
        cannon(0, H * 0.95, 70, up + 0.55, 0.35, 700, 1250);
        cannon(W, H * 0.95, 70, up - 0.55, 0.35, 700, 1250);
        for (let i = 0; i < 50; i++) cannon(rand(0, W), -20 * dpr, 1, Math.PI / 2, 0.4, 120, 380);

        const gravity = 1300 * dpr;
        let last = performance.now();
        function frame(now) {
            const dt = Math.min((now - last) / 1000, 0.05);
            last = now;
            ctx.clearRect(0, 0, W, H);
            let alive = 0;
            for (const p of parts) {
                p.age += dt;
                if (p.age >= p.life || p.y > H + 40 * dpr) continue;
                alive++;
                p.vy += gravity * dt;
                p.vx *= (1 - 1.4 * dt);
                p.vy *= (1 - 0.6 * dt);
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.rot += p.vr * dt;
                p.flip += p.vf * dt;
                const fade = Math.min(1, (p.life - p.age) / 0.8);
                ctx.save();
                ctx.globalAlpha = Math.max(0, fade);
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.scale(1, Math.cos(p.flip));
                ctx.fillStyle = p.color;
                if (p.round) {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
                }
                ctx.restore();
            }
            if (alive > 0) {
                confettiFrame = requestAnimationFrame(frame);
            } else {
                confettiFrame = null;
                ctx.clearRect(0, 0, W, H);
            }
        }
        confettiFrame = requestAnimationFrame(frame);
    }

    function showWinner(winner, celebrate = true) {
        resultImg.src = winner.image;
        resultName.innerText = winner.name;
        overlay.classList.add('active');
        btn.classList.add('hidden');
        if (celebrate) {
            // конфетти запускается, когда приз «выпрыгивает» на экран
            confettiTimer = setTimeout(launchConfetti, 600);
            if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
        }
    }

    if (!isIPadMode) {
        const savedWinId = localStorage.getItem('wonPrizeId');
        if (savedWinId) {
            const savedWinner = prizes.find(p => p.id === savedWinId);
            if (savedWinner) showWinner(savedWinner, false);
        }
    }

    if (isIPadMode) closeBtn.classList.add('visible');

    async function notifyTelegramBot(prizeName) {
        if (!userChatId || TELEGRAM_BOT_TOKEN === 'ВАШ_ТОКЕН_БОТА_ОТ_BOTFATHER') return;
        const message = `Поздравляем! Ваш приз: ${prizeName}. Подойдите на стойку Linvol, чтобы его получить.`;
        
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
        stopConfetti();
        overlay.classList.remove('active');
        btn.classList.remove('hidden');
        mode = 'idle';   // лента снова плавно начинает медленно крутиться
    });
});
