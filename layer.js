const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');
const colors = require('colors');
const readline = require('readline');

class Layernet {
    constructor() {
        this.dataFilePath = path.join(__dirname, 'data.txt');
        this.baseURL = 'https://tongame-service-roy7ocqnoq-ew.a.run.app';
        this.ws = null;
        this.gameStarted = false;
        this.isRound2Active = false;
        this.claimingCoin = false;
        this.startingGame = false;
        this.gameCount = 1;
        this.maxGames = 5; // Jumlah maksimal permainan
    }

    log(msg) {
        console.log(`[*] ${msg}`);
    }

    async getQueryIdAndUserData() {
        try {
            const data = fs.readFileSync(this.dataFilePath, 'utf8')
                .replace(/\r/g, '')
                .split('\n')
                .filter(Boolean);

            if (data.length === 0) {
                throw new Error('data.txt kosong atau tidak ditemukan.');
            }

            const queryIdLine = data[0];
            const queryParams = new URLSearchParams(queryIdLine);
            const userDataString = queryParams.get('user');

            if (!userDataString) {
                throw new Error('Data pengguna tidak ditemukan dalam query_id.');
            }

            const userData = JSON.parse(decodeURIComponent(userDataString));

            if (!userData.id) {
                throw new Error('Data pengguna tidak valid: id tidak ditemukan.');
            }

            return { queryId: queryIdLine, userData };
        } catch (error) {
            console.error('Kesalahan membaca query_id dan data pengguna:', error);
            throw error;
        }
    }

    async getAccessToken(queryId, userData) {
        const url = `${this.baseURL}/api/user/login`;
        const payload = {
            telegramId: userData.id,
            firstName: userData.first_name,
            lastName: userData.last_name,
            languageCode: userData.language_code,
            isVip: false
        };

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${queryId}`,
                    'Origin': 'https://netcoin.layernet.ai',
                    'Referer': 'https://netcoin.layernet.ai/',
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
                }
            });

            if (response.data.success) {
                return response.data.data.accessToken;
            } else {
                throw new Error('Login gagal');
            }
        } catch (error) {
            console.error('Kesalahan mendapatkan access token:', error);
            throw error;
        }
    }

    async connectWebSocket(accessToken) {
        const wsURL = `${this.baseURL}/socket.io/?EIO=4&transport=websocket`;
        const headers = {
            'Origin': 'https://netcoin.layernet.ai',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
        };

        this.ws = new WebSocket(wsURL, { headers });

        this.ws.on('open', () => {
            this.log('Login berhasil!');
            this.sendAuthMessage(accessToken);
        });

        this.ws.on('message', (message) => {
            this.handleMessage(message);
        });

        this.ws.on('close', () => {
            this.log('Koneksi ke server dihentikan!');
        });

        this.ws.on('error', (error) => {
            console.error('Kesalahan koneksi ke server:', error);
        });
    }

    sendAuthMessage(accessToken) {
        const authMessage = JSON.stringify({ token: `Bearer ${accessToken}` });
        this.ws.send(`40${authMessage}`);
        setTimeout(() => this.sendHomeDataRequest(), 1000);
    }

    sendHomeDataRequest() {
        const homeDataRequest = JSON.stringify(["homeData"]);
        this.ws.send(`420${homeDataRequest}`);
    }

    handleMessage(message) {
        let messageStr = message.toString();
        const jsonMessageMatch = messageStr.match(/^\d+\[(\{.*\})\]$/);
        if (jsonMessageMatch) {
            try {
                const parsedMessage = JSON.parse(jsonMessageMatch[1]);
                if (parsedMessage[0] === "exception") {
                    const { message } = parsedMessage[1];
                    if (message === "Game not started" && this.isRound2Active) {
                        this.log('Pesan "Game not started" diterima. Menghentikan Round 2.');
                        this.isRound2Active = false;
                        this.sendHomeDataRequest();
                        return;
                    }
                }
                this.processGameData(parsedMessage);
            } catch (error) {
                this.log(`Gagal menguraikan pesan sebagai JSON: ${error.message}`);
            }
        }
    }

    processGameData(data) {
        const { userRank, claimCountdown, gold, dogs } = data;
        if (userRank && claimCountdown) {
            const { role, profitPerHour } = userRank;
            const { minutes, seconds } = claimCountdown;
            this.log(`Peran: ${role}, ProfitPerHour: ${profitPerHour}, Saldo: ${gold}, DOGS: ${dogs}`);
            const totalMinutesRemaining = minutes + (seconds / 60);
            this.log(`Waktu klaim tersisa: ${minutes} menit ${seconds} detik`);
            if (!this.gameStarted && !this.claimingCoin && totalMinutesRemaining < 10) {
                this.claimCoin();
            }
            if (!this.startingGame) {
                setTimeout(() => this.startGame(), 3000);
            }
        }
    }

    async claimCoin() {
        if (this.claimingCoin) {
            this.log('Koin sudah dalam proses klaim.');
            return;
        }
        this.claimingCoin = true;
        this.log('Mengklaim koin...');
        const withdrawClaimMessage = JSON.stringify(['withdrawClaim']);
        this.ws.send(`42${withdrawClaimMessage}`);
        setTimeout(() => {
            this.claimingCoin = false;
            this.sendHomeDataRequest();
        }, 2000);
    }

    async startGame() {
        if (this.startingGame) return;
        this.startingGame = true;
        this.log(`Memulai permainan, jangan menutup alat sebelum selesai!`);
        const startGameMessage = JSON.stringify(["startGame"]);
        this.ws.send(`422${startGameMessage}`);

        this.gameStarted = true;
        this.isRound2Active = true;
        await this.playRound(1);
    }

    async playRound(roundNumber) {
        let bodem = 2;
        let messageCount = 0;
        const interval = setInterval(() => {
            if (messageCount < 60) {
                const inGameMessage = JSON.stringify(["inGame", { round: roundNumber, time: Date.now(), gameover: false }]);
                this.ws.send(`42${bodem}${inGameMessage}`);
                messageCount++;
                bodem++;
            } else {
                clearInterval(interval);
                if (roundNumber === 1) {
                    this.log('Menyelesaikan round 1, memulai Round 2.');
                    this.playRound2(2);
                }
            }
        }, 10000 / 60);
    }

    async playRound2(roundNumber) {
        let bodem = 63;
        let messageCount = 0;
        const interval = setInterval(() => {
            if (messageCount < 100) {
                if (this.isRound2Active) {
                    const inGameMessage = JSON.stringify(["inGame", { round: roundNumber, time: Date.now(), gameover: false }]);
                    this.ws.send(`42${bodem}${inGameMessage}`);
                    messageCount++;
                    bodem++;
                }
            } else {
                clearInterval(interval);
                if (this.isRound2Active) {
                    this.log('Round 2 selesai!');
                    this.sendHomeDataRequest();
                    this.isRound2Active = false;
                    this.startingGame = false;
                    this.gameCount++;
                    if (this.gameCount < this.maxGames) {
                        this.log(`Memulai ulang game (${this.gameCount}/${this.maxGames})`);
                        setTimeout(() => this.startGame(), 1000);
                    } else {
                        this.log('Menyelesaikan semua putaran permainan!');
                        this.ws.close();
                    }
                }
            }
        }, 50000 / 100);
    }

    async waitWithCountdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[*] Tunggu ${i} detik untuk melanjutkan...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('');
    }

    async main() {
        while (true) {
            try {
                const data = fs.readFileSync(this.dataFilePath, 'utf8')
                    .replace(/\r/g, '')
                    .split('\n')
                    .filter(Boolean);

                if (data.length === 0) {
                    throw new Error('data.txt kosong atau tidak ditemukan.');
                }

                for (let index = 0; index < data.length; index++) {
                    const queryIdLine = data[index];
                    const queryParams = new URLSearchParams(queryIdLine);
                    const userDataString = queryParams.get('user');

                    if (!userDataString) {
                        console.log(`Akun ${index + 1}/${data.length}: Data pengguna tidak ditemukan.`);
                        continue;
                    }

                    const userData = JSON.parse(decodeURIComponent(userDataString));

                    if (!userData.id) {
                        console.log(`Akun ${index + 1}/${data.length}: ID pengguna tidak valid.`);
                        continue;
                    }

                    console.log(`========== Akun ${index + 1}/${data.length} | ${userData.first_name} ==========`);


                    const layernet = new Layernet();
                    const accessToken = await layernet.getAccessToken(queryIdLine, userData);
                    await layernet.connectWebSocket(accessToken);

                    await new Promise(resolve => layernet.ws.on('close', resolve));
                    await this.waitWithCountdown(3);
                }

                await this.waitWithCountdown(30);

            } catch (error) {
                console.error('Kesalahan dalam proses:', error);
            }
        }
    }
}

if (require.main === module) {
    const layernet = new Layernet();
    layernet.main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
