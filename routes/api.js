const express = require('express');
const router = express.Router();
const BitShares = require('btsdex');
const jsonFile = require('jsonfile');
const CONFIG = jsonFile.readFileSync('./config.json');

BitShares.connect(CONFIG.node);
BitShares.subscribe('connected', startAfterConnected);
BitShares.subscribe('block', callEachBlock);

async function startAfterConnected() {

}

async function callEachBlock(obj) {
    console.log(obj)
}

router.get('/test', async function (req, res, next) {

});


module.exports = router;