const express = require('express');
const router = express.Router();
const BitShares = require('btsdex');
const jsonFile = require('jsonfile');
const CONFIG = jsonFile.readFileSync('./config.json');
const emitter = require('../emitter');
const ChainTypes = require('bitsharesjs/dist/chain/src/ChainTypes.js');

const opKeys = Object.keys(ChainTypes.operations);
let operations = [];
for (let i = 0; i < opKeys.length; i++) {
    operations[ChainTypes.operations[opKeys[i]]] = opKeys[i];
}

console.log(operations)

BitShares.connect(CONFIG.node);
BitShares.subscribe('connected', startAfterConnected);
BitShares.subscribe('block', callEachBlock);


let globalProperties = null;

async function startAfterConnected() {
    globalProperties = await BitShares.db.get_global_properties();
}

async function callEachBlock(obj) {
    //console.log(obj[0])
    const witness = await BitShares.db.get_objects([obj[0].current_witness]);
    const witnessAccount = await BitShares.db.get_objects([witness[0].witness_account]);
    const txs = (await BitShares.db.get_block(obj[0].head_block_number)).transactions;
    //console.log('witnessAccount', witnessAccount[0].name);

    let records = [];
    let feesBlock = 0;
    for (let i = 0; i < txs.length; i++) {
        for (let j = 0; j < txs[i].operations.length; j++) {
            //{ "fee": { "amount": 482, "asset_id": "1.3.0" }, "fee_paying_account": "1.2.33015", "order": "1.7.455419963", "extensions": [] }
            const opType = operations[txs[i].operations[j][0]];
            const op = txs[i].operations[j][1];
            //console.log(op)
            let opAccount = null;
            let ext = null;
            if (opType === 'limit_order_cancel') {
                opAccount = (await BitShares.db.get_objects([op.fee_paying_account]))[0];
            }

            if (opType === 'limit_order_create') {
                //console.log(op)
                opAccount = (await BitShares.db.get_objects([op.seller]))[0];
                let assetSell = (await BitShares.db.get_objects([op.amount_to_sell.asset_id]))[0];
                let assetReceive = (await BitShares.db.get_objects([op.min_to_receive.asset_id]))[0]

                ext = {
                    from: opAccount.name,
                    sell: {
                        s: assetSell.symbol,
                        amount: op.amount_to_sell.amount / 10 ** assetSell.precision,
                        p: assetSell.precision
                    },
                    receive: {
                        s: assetReceive.symbol,
                        amount: op.min_to_receive.amount / 10 ** assetReceive.precision,
                        p: assetReceive.precision
                    },
                    price: ((op.min_to_receive.amount / 10 ** assetReceive.precision) / (op.amount_to_sell.amount / 10 ** assetSell.precision)).toFixed(assetSell.precision)

                }
                //console.log('ext', ext)
            }

            if (opType === 'asset_publish_feed') {
                opAccount = (await BitShares.db.get_objects([op.publisher]))[0];
            }

            if (opType === 'transfer') {
                let asset = (await BitShares.db.get_objects([op.amount.asset_id]))[0]
                try {
                    ext = {
                        from: (await BitShares.db.get_objects([op.from]))[0],
                        to: (await BitShares.db.get_objects([op.to]))[0],
                        asset: {
                            s: asset.symbol,
                            p: asset.precision
                        },
                        amount: op.amount.amount / 10 ** asset.precision,
                    }
                } catch (e) {
                    console.log('err', e)
                }
                //console.log(op)
            }

            //console.log(txs)

            let fee = null;
            if (op.fee) {
                //console.log(op.fee)
                let feeAsset = (await BitShares.db.get_objects([op.fee.asset_id]))[0]
                let amountFee = op.fee.amount / (10 ** feeAsset.precision);
                fee = {
                    asset: feeAsset.symbol,
                    amount: amountFee.toFixed(feeAsset.precision)
                };
                if (feeAsset.symbol === 'BTS') {
                    feesBlock = feesBlock + amountFee;
                }
                //console.log(feeAsset)
            }

            records.unshift({
                opId: txs[i].operations[j][0],
                type: opType,
                op: op,
                account: opAccount,
                block: obj[0].head_block_number,
                ext: ext,
                fee: fee,

            })
        }
    }


    emitter.eventBus.sendEvent('block:response', {
        op: 'block:response',
        data: {
            witness: witnessAccount[0].name,
            block: obj[0],
            records: records,
            txs: txs,
            fees: feesBlock.toFixed(5),
        },
    });

    //console.log(result)
}

router.get('/global-properties', async function (req, res, next) {
    await res.json(globalProperties);
});

router.get('/dynamic-properties', async function (req, res, next) {
    await res.json(await BitShares.db.get_dynamic_global_properties());
});

router.get('/config', async function (req, res, next) {
    await res.json(await BitShares.db.get_config());
});

router.get('/chain', async function (req, res, next) {
    await res.json(await BitShares.db.get_chain_properties());
});

router.get('/get-account/:account', async function (req, res, next) {
    const account = await BitShares.accounts[req.params.account]
    let ops = await BitShares.history.get_account_history(account.id, "1.11.0", 10, "1.11.0")
    await res.json({
        account: account,
        history: ops
    });
});

router.get('/assets', async function (req, res, next) {
    await res.json(await BitShares.db.list_assets("XBTSX", 100))
});

router.post('/assets', async function (req, res, next) {
    await res.json(await BitShares.db.get_assets(req.body.assets))
});

router.get('/asset-name/:asset', async function (req, res, next) {
    let data = await BitShares.assets[req.params['asset']]

    try {
        data.options.description = JSON.parse(data.options.description);
        data.options.description.main = data.options.description.main.replace(/[\r\n]+/gm, "");
    } catch (e) {

    }

    await res.json(data);
});

router.get('/asset-id/:id', async function (req, res, next) {
    await res.json(await BitShares.assets.id(req.params['id']));
});

router.get('/asset-holders/:asset', async function (req, res, next) {
    let assetId = (await BitShares.assets[req.params['asset']]).id;
    let holders = await BitShares.assets.asset_holders_count(assetId)
    //await res.json();
    await res.json(holders)
});

router.get('/block/:height', async function (req, res, next) {
    const block = await BitShares.db.get_block(req.params['height']);
    const witness = (await BitShares.db.get_objects([block.witness]))[0];
    const user = (await BitShares.db.get_objects([witness.witness_account]))[0];
    let txs = [];
    for (let i = 0; i < block.transactions.length; i++) {
        console.log(block.transactions[i].operations[0][1]);
        let account = null;
        if (block.transactions[i].operations[0][1].fee_paying_account) {
            account = (await BitShares.db.get_objects([block.transactions[i].operations[0][1].fee_paying_account]))[0]
        }

        if (block.transactions[i].operations[0][1].publisher) {
            account = (await BitShares.db.get_objects([block.transactions[i].operations[0][1].publisher]))[0]
        }

        if (block.transactions[i].operations[0][1].seller) {
            account = (await BitShares.db.get_objects([block.transactions[i].operations[0][1].seller]))[0]
        }

        console.log(block.transactions[i].operations[0][1])
        txs.push({
            order: block.transactions[i].operations[0][1].order,
            op: operations[block.transactions[i].operations[0][0]],
            account: account
        });
    }
    await res.json({
        raw: block,
        data: {
            witness: witness,
            user: user,
            txs: txs
        }
    });
});

router.get('/holders/:symbol', async function (req, res, next) {
   await res.json(await BitShares.holders(req.params['symbol']));
});

router.get('/object/:id', async function (req, res, next) {
    let result = null;
    try {
        result = await BitShares.db.get_objects([req.params['id']])
    } catch(e) {
        result = e;
    }

    await res.json(result);
});

/** FOR UI **/
router.post('/objects', async function (req, res, next) {
    let result = null;
    try {
        result = await BitShares.db.get_objects(req.body.objects)
    } catch(e) {
        result = e;
    }
    await res.json(result);
});

router.get('/lp-history/:id', async function (req, res, next) {
    let result = null;
    try {
        result = await BitShares.history.get_liquidity_pool_history(req.params['id'])
    } catch(e) {
        result = e;
    }
    await res.json(result);
});

router.post('/lp-history', async function (req, res, next) {
    let result = null;
    try {
        result = await BitShares.history.get_liquidity_pool_history(req.body.id, null, null, req.body.limit, req.body.op)
    } catch(e) {
        result = e;
    }
    await res.json(result);
});



module.exports = router;
