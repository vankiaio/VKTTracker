import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EosService } from './eos.service';
import { Observable, Subject, timer, from, forkJoin, of } from 'rxjs';
import { map, filter, share, withLatestFrom, switchMap, catchError, take } from 'rxjs/operators';

const EOS_QUOTE = 60000;
const RAM_QUOTE = 60000;
const GET_INFO_INTERVAL = 5000;

@Injectable({
  providedIn: 'root'
})
export class AppService {

  private latestBlockNumberSource = new Subject<number>();

  latestBlockNumber$ = this.latestBlockNumberSource.asObservable();
  isMaintenance$: Observable<boolean>;
  // eosQuote$: Observable<any>;
  vktQuote$: Observable<any>;
  ramQuote$: Observable<any>;
  info$: Observable<any>;
  latestBlock$: Observable<any>;
  recentBlocks$: Observable<any[]>;
  recentTransactions$: Observable<any[]>;
  price_vkteth$ = 0;

  constructor(
    private http: HttpClient,
    private eosService: EosService
  ) {
    this.info$ = timer(0, GET_INFO_INTERVAL).pipe(
      switchMap(() => this.eosService.getDeferInfo()),
      share()
    );
    this.latestBlock$ = this.info$.pipe(
      switchMap((info: any) => from(this.eosService.getDeferBlock(info.head_block_num))),
      share()
    );
    this.recentBlocks$ = this.latestBlock$.pipe(
      switchMap((block: any) => {
        const blockNumber: number = block.block_num;
        const blockNumbers: number[] = [blockNumber - 1, blockNumber - 2, blockNumber - 3, blockNumber - 4];
        const blockNumbers$: Observable<any>[] = blockNumbers.map(blockNum => this.eosService.getDeferBlock(blockNum).pipe(catchError(() => of(null))));
        return forkJoin(blockNumbers$).pipe(
          map((blocks) => [block, ...blocks].filter(block => block !== null))
        );
      }),
      share()
    );
    this.recentTransactions$ = this.recentBlocks$.pipe(
      map((blocks: any[]) => {
        return blocks.reduce((previous, current) => {
          const transactions = current.transactions.map(transaction => {
            return {
              ...transaction,
              block_num: current.block_num,
              trx: typeof transaction.trx === 'string' ? { id: transaction.trx } : transaction.trx
            };
          })
          return previous.concat(transactions);
        }, []);
      }),
      share()
    );
    this.isMaintenance$ = this.info$.pipe(
      withLatestFrom(this.latestBlockNumber$),
      map(([chainStatus, blockNumber]) => {
        return (chainStatus.head_block_num - blockNumber) > 600;
      }),
      share()
    );
    // this.eosQuote$ = timer(0, EOS_QUOTE).pipe(
    //   switchMap(() => this.getEOSTicker()),
    //   filter(ticker => !!ticker.data),
    //   map(ticker => ticker.data),
    //   share()
    // );
    this.vktQuote$ = timer(0, EOS_QUOTE).pipe(
      switchMap(() => this.getVKTTicker()),
      share()
    );

    this.ramQuote$ = timer(0, RAM_QUOTE).pipe(
      switchMap(() => from(this.eosService.eos.getTableRows({
        json: true,
        code: "eosio",
        scope: "eosio",
        table: "rammarket"
      }))),
      filter((data: any) => data.rows && data.rows.length),
      map(data => data.rows[0]),
      map(data => {
        const base = Number(data.base.balance.replace('RAM', ''));
        const quote = Number(data.quote.balance.replace('VKT', ''));
        return {
          ...data,
          price: quote / base
        };
      }),
      share()
    );
  }

  getBlocks(blockNumber?: number, limit = 10): Observable<any[]> {
    let blockNumber$: Observable<number>;
    if (blockNumber) {
      blockNumber$ = of(blockNumber);
    } else {
      blockNumber$ = this.info$.pipe(
        take(1),
        map(info => info.head_block_num)
      );
    }
    return blockNumber$.pipe(
      switchMap(blockNumber => {
        let blockNumbers: number[] = [];
        for (let i = blockNumber; i > blockNumber - limit && i > 0; i--) {
          blockNumbers.push(i);
        }
        const blockNumbers$: Observable<any>[] = blockNumbers.map(blockNumber => {
          return this.eosService.getDeferBlock(blockNumber).pipe(
            catchError(() => of(null))
          );
        });
        return forkJoin(blockNumbers$).pipe(
          map(blocks => blocks.filter(block => block !== null))
        );
      })
    );
  }

  getTokens(): Observable<any[]> {
    return this.http.get<any[]>(`https://raw.githubusercontent.com/eoscafe/eos-airdrops/master/tokens.json`);
  }

  getEOSTicker(): Observable<CMCTicker> {
    return this.http.get<CMCTicker>('https://api.coinmarketcap.com/v2/ticker/1765/');
  }

  async getVKTTicker() {
    let ticker_vkteth = [];
    let ticker_ethcny = [];
    // import ccxt
    const ccxt = require('ccxt');

    // get vkteth price and vol
    let bitforex = new ccxt.bitforex();
    // load all markets from the exchange
    let markets = await bitforex.loadMarkets();

    const symbol_vkteth = 'VKT/ETH';
    if (symbol_vkteth in bitforex.markets) {
      ticker_vkteth = await bitforex.fetchTicker(symbol_vkteth);
    }
    console.log(ticker_vkteth);
    
    // get ethcny price
    let coinmarketcap = new ccxt.coinmarketcap();
    // load all markets from the exchange
    markets = await coinmarketcap.loadMarkets();
    
    const symbol_ethcny = 'ETH/CNY';
    if (symbol_ethcny in coinmarketcap.markets) {
      ticker_ethcny = await coinmarketcap.fetchTicker(symbol_ethcny);
    }
    console.log(ticker_ethcny);

    // get vkteth 1hour price
    const ohlcv1h = await bitforex.fetchOHLCV(symbol_vkteth, '1d', 8);
    const last1hPrice = ohlcv1h[ohlcv1h.length - 2]['close']; // 1h ago closing price
    const last1dPrice = ohlcv1h[ohlcv1h.length - 2]['close']; // 1d ago closing price
    const last1wPrice = ohlcv1h[1]['close']; // 1w ago closing price
    console.log(ticker_vkteth['close']);
    console.log(last1hPrice);
    console.log(last1dPrice);
    console.log(last1wPrice);
    console.log(ohlcv1h);
    
    this.price_vkteth$ = ticker_vkteth['close'];

    // const ohlcv1d = await bitforex.fetchOHLCV(symbol_vkteth, '7d');
    // const last1dPrice = ohlcv1d[ohlcv1d.length - 1][index]; // closing price
    // console.log(ohlcv1d);
    
    return {
      'symbol': symbol_vkteth,
      'price_vktcny': ticker_vkteth['close'] * ticker_ethcny['close'],
      'price_vkteth': ticker_vkteth['close'],
      'volume_24h': ticker_vkteth['baseVolume'],
      'circulating_supply': 500000000,
      'total_supply': 1000000000,
      'percent_change_1h': (ticker_vkteth['close'] - last1hPrice) / last1hPrice,
      'percent_change_1d': (ticker_vkteth['close'] - last1dPrice) / last1dPrice,
      'percent_change_7d': (ticker_vkteth['close'] - last1wPrice) / last1wPrice
    };
}

  getBpJson(url: string): Observable<any> {
    return this.http.get<any>(`${url}/bp.json`);
  }

  setLatestBlockNumber(blockNumber: number) {
    if (blockNumber) {
      this.latestBlockNumberSource.next(blockNumber);
    }
  }

}

export interface CMCTicker {
  data?: {
    name: string;
    symbol: string;
    quotes: {
      USD: {
        price: number,
        market_cap: number,
        volume_24h: number
      }
    }
  };
  metadata?: any
}