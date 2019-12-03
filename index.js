const render = require('./render')

const FormData = require('form-data')
const request = require('request-promise-native')
const express = require('express')
const pdflib = require('pdf-lib')
const fetch = require('node-fetch')
const AWS = require('aws-sdk')
const uuid = require('uuid')
const AirtablePlus = require('airtable-plus')
const multer = require('multer')
const _ = require('lodash')

const {
    PDFDocument,
    StandardFonts,
    grayscale,
    degrees
} = pdflib

const upload = multer({
    storage: multer.memoryStorage(), 
    dest: __dirname + '/uploads/images'
})

AWS.config.update({region: 'us-west-2'})
s3 = new AWS.S3({apiVersion: '2006-03-01'});

const mailMissionsTable = new AirtablePlus({
    apiKey: process.env.AIRTABLE_API_KEY,
    baseID: 'apptEEFG5HTfGQE7h',
    tableName: 'Mail Missions'
})

const fetchMailMission = async id => {
    console.log('Fetching mission with id '+id)
    const mission = await mailMissionsTable.read({
        filterByFormula: `{Record ID} = '${id}'`,
        maxRecords: 1
    })
    console.log(mission)
    return mission
}
const app = express()

app.use(express.json())
app.use(express.static('public'))
app.use(express.urlencoded({extended: false}))

app.use(function(req, res, next) {
   res.header("Access-Control-Allow-Origin", "*");
   res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
   next();
})

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running on port 3000");
})

const stackText = async (args) => {
    const {
        page,
        text,
        originX,
        originY,
        font,
        size,
        gap = 2
    } = args

    _.each(text, (v, i) => {
        page.drawText(v, {
            x: originX,
            y: originY-i*(size+gap)-size,
            font,
            size,
        })
    })
}

app.post('/address-label', async function(req, res) {
    console.log('we r gettin requested for a address label!!')

    try {
        const {
            toAddress,
            fromAddress,
        } = req.body

        const ppi = 80

        const pdf = await PDFDocument.create()
        const page = pdf.addPage([ppi*4, ppi*6])
        const helveticaFont = await pdf.embedFont(pdflib.StandardFonts.Helvetica)

        const { width, height } = page.getSize()
        const fontSize = 30

        const extractAddress = address => {
            const lines = [
                address.name,
                address.street1,
                address.street2,
                address.street3,
                `${address.city}, ${address.state}`,
                `${address.postalCode} (${address.country})`
            ]

            return _.compact(lines)
        }

        stackText({
            page,
            text: extractAddress(fromAddress),
            originX: 0,
            originY: height,
            size: 10,
            font: helveticaFont,
        })

        stackText({
            page,
            text: extractAddress(toAddress),
            originX: ppi,
            originY: height - ppi*2.5,
            size: 15,
            font: helveticaFont,
        })

        const stampSize = ppi*2/3
        const stampX = width-stampSize
        const stampY = height-stampSize-1

        page.drawRectangle({
            x: stampX,
            y: stampY,
            width: stampSize,
            height: stampSize,
            borderWidth: 2,
            borderColor: grayscale(0)
        })
    
        const labelData = await pdf.saveAsBase64()

        res.send({
            labelData
        })
    }
    catch (err) {
        console.log('ummmmm something bad hapend :(((')
        console.log(err)
        res.error(err)
    }
})

app.post('/scan', async function(req, res) {
    console.log('sum1 scanned a package!!')

    try {
        const {
            missionRecordId,
            scanType
        } = req.body

        console.log(`its a ${scanType} scan for mission ${missionRecordId}. getin the airtable record`)
        console.log(req)

        const missionRecord = await mailMissionsTable.find(missionRecordId)

        console.log(missionRecord)

        if (!missionRecord) throw new Error('Could not find Mail Mission with Record ID: '+missionRecordId)
        
        console.log('ok got the record!', missionRecord.fields)

        
        const senderScanTime = missionRecord.fields['Sender Scan Time']
        const receiverScanTime = missionRecord.fields['Receiver Scan Time']
        const receiverName = missionRecord.fields['Receiver Name']
        const senderName = missionRecord.fields['Sender Name']
        const scenarioName = missionRecord.fields['Scenario Name']
        const trackingUrl = missionRecord.fields['Tracking URL']
        const scannedExternal = missionRecord.fields['Sender Scanned']
        const scannedInternal = missionRecord.fields['Receiver Scanned']

        const scanned = (scanType == 'external' && scannedExternal) || (scanType == 'internal' && scannedInternal)

        console.log(`this is an ${scanType} scan of a ${scenarioName} from ${senderName} to ${receiverName} which ${scannedInternal ? 'has' : 'has not'} been scanned internally and ${scannedExternal ? 'has' : 'has not'} been scanned externally`)

        if (!scanned) {
            console.log('Sending POST to zapier')

            const zapResponse = await (await fetch('https://hooks.zapier.com/hooks/catch/507705/o477r92/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    missionRecordId,
                    scanType
                })
            })).json()
            
            console.log('POST sent to Zapier: ', zapResponse)
        }

        res.send({
            scannedInternal,
            scannedExternal,
            senderScanTime,
            receiverScanTime,
            receiverName,
            senderName,
            trackingUrl,
            scenarioName
        })
    }
    catch (err) {
        console.log('ummmmm something bad hapend :(((')
        console.log(err)
        res.error(err)
    }
})

app.post('/photo-receipt', upload.single('photo'), async function (req, res) {
    console.log('oh boy oh boy here comes a request to post a photo receipt!!')

    try {
        const {
            missionRecordId,
            fileType = 'png',
            type
        } = req.body


        console.log(`ok this is a ${type} photo for mission ${missionRecordId}`)
        console.log(req)

        const uploadParams = {
            Bucket: 'hackclub-shipping-photos',
            Key: missionRecordId+'-'+type+'.'+fileType,
            ACL: 'public-read',
            Body: req.file.buffer
        }

        console.log('uploading 2 amazon s3 :D')

        const s3Response = await s3.upload(uploadParams).promise()
        
        if (s3Response.err) {
            console.log('uh oh s3 says very bad hapin :(');
            console.log(s3Response)
            return
        }

        console.log('s3 says upload suxes!!')

        const photoLocation = s3Response.Location
        console.log(photoLocation)

        console.log('sendin to mr. zapier now.')

        const zapResponse = await fetch('https://hooks.zapier.com/hooks/catch/507705/o61o7iw/', {
            method: 'POST',
            body: JSON.stringify({
                missionRecordId,
                photoUrl: photoLocation,
                type
            })
        })

        console.log('sended to mr. zap!')

        res.send({
            message: 'Success'
        })
    }
    catch (err) {
        console.log('ummmmm something bad hapend :(((')
        console.log(err)
        res.send(err)
    }
})

app.post('/bounce', function (req, res) {
    console.log('oh boy oh boy here comes a request!!')

    try {
        const {
            fileData,
            fileType,
            fileName,
            message,
            thread,
            token,
            channel
        } = req.body

        console.log('hmmm, lots of stuff to unpack here...')

        var buffer = Buffer.from(fileData, 'base64')
        var form = new FormData()

        console.log('ok i made a buffer and a form')

        form.append('token', token)
        form.append('thread_ts', thread)
        form.append('channels', channel)
        form.append('filename', fileName)
        form.append('filetype', fileType)
        form.append('initial_comment', message)
        form.append('file', buffer, {
            filename: fileName+'.'+fileType
        })

        console.log('yay everything is appended to the form! redy to send :))')
        
        form.submit('https://slack.com/api/files.upload', function(err, response) {
            if (err) {
                console.log('i submitted but i got error :(')
                console.log(err)
                res.send(err)
            }
            else {
                console.log('i submitted and it is good so happy!!!!!')
                // console.log(response)
                res.send({
                    statusCode: response.statusCode,
                    statusMessage: response.statusMessage,
                    message: response.message,
                    file: response.file,
                })
            }
        })
    }
    catch (err) {
        console.log('ummmmm something bad hapend :(((')
        console.log(err)
        res.send(err)
    }
})

async function reformatToA4(args) {
    const {
        labels,
        missionRecordId,
        scenarioName,
        receiverName,
        missionNote,
        clubName,
        externalQrBytes,
        receiptQrBytes,
    } = args

    console.log('ok maam i will reformat these labels to fit the A4 sticky label sheets :)')

    const externalLabelImage = await render(labels, 1)
    const internalLabelImage = await render(labels, 2)

    console.log('i rendered the pages to images hoo-rah!!')

    const pdf = await PDFDocument.create()
    const helveticaFont = await pdf.embedFont(StandardFonts.Helvetica)

    const page = pdf.addPage()

    const externalLabelEmbedded = await pdf.embedPng(externalLabelImage)
    const internalLabelEmbedded = await pdf.embedPng(internalLabelImage)

    const receiptQrEmbedded = await pdf.embedPng(receiptQrBytes)

    // const externalQrImage = await pdf.embedPng(externalQrBytes)

    const width = page.getWidth()
    const height = page.getHeight()

    const ppi = 80

    page.drawImage(internalLabelEmbedded, {
        x: page.getWidth() / 2 + ppi*3 - 12,
        y: page.getHeight() / 2 - ppi*4.125 + 10,
        width: ppi*4-16,
        height: ppi*6-24,
        rotate: degrees(90)
    })

    page.drawImage(externalLabelEmbedded, {
        x: page.getWidth() / 2 + ppi*3 - 12,
        y: page.getHeight() / 2 + ppi*0.125 + 4,
        width: ppi*4-16,
        height: ppi*6-24,
        rotate: degrees(90)
    })

    const qrSize = ppi*3/4

    page.drawImage(receiptQrEmbedded, {
        x: 10,
        y: page.getHeight() - qrSize - 10,
        width: qrSize,
        height: qrSize,
    })
        
    page.drawText(receiverName, {
        x: qrSize+20,
        y: height-22,
        size: 10,
        font: helveticaFont
    })
    
    page.drawText(scenarioName, {
        x: qrSize+20,
        y: height-34,
        size: 10,
        font: helveticaFont
    })

    page.drawText(clubName || '', {
        x: qrSize+20,
        y: height-46,
        size: 10,
        font: helveticaFont
    })

    page.drawText(missionRecordId || '', {
        x: qrSize+20,
        y: height-58,
        size: 10,
        font: helveticaFont
    })

    page.drawText(missionNote || '', {
        x: qrSize+20,
        y: height-70,
        size: 10,
        font: helveticaFont
    })

    console.log('now i drawd those imuges on a new pdf')

    var newPdf = await pdf.save()
    return newPdf
}

app.post('/shipping-label', async function (req, res) {
    console.log('oh boy oh boy here comes a request to prepare a shipping label!!')

    // try {
        const {
            scenarioName,
            receiverName,
            missionNote,
            clubName,
            fileData,
            fileName,
            message,
            thread,
            token,
            channel,
            receiptQrUrl,
            internalQrUrl,
            externalQrUrl,
            missionRecordId,
            format
        } = req.body

        console.log(`hmmm, lots of stuff to unpack here for this ${scenarioName} shipment...`)

        var buffer = Buffer.from(fileData, 'base64')

        var pdfDoc = await PDFDocument.load(buffer)
        var helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica)

        console.log('i loaded the documint from the base64 data suxesfuly')

        var pages = pdfDoc.getPages()
        var firstPage = pages[0]

        console.log('first i resize the page')

        const originalHeight = firstPage.getHeight()
        const originalWidth = firstPage.getWidth()
        const widthOffset = originalWidth/7
        const heightOffset = originalHeight/7

        firstPage.setSize(originalWidth + widthOffset, originalHeight + heightOffset)
        firstPage.translateContent(widthOffset/2, heightOffset)

        var { width, height } = firstPage.getSize()
        
        console.log('then i drawd the text to the first page')

        const qrSize = 48

        // firstPage.drawRectangle({
        //     x: 0,
        //     y: 0,
        //     width: width,
        //     height: height,
        //     borderWidth: 1,
        //     borderColor: grayscale(0)
        // })

        stackText({
            page: firstPage,
            text: [receiverName, scenarioName, missionRecordId],
            originX: 10+qrSize,
            originY: 50-heightOffset,
            size: 10,
            font: helveticaFont
        })

        const externalQrBytes = await fetch(externalQrUrl).then((res) => res.arrayBuffer())
        const externalQrImage = await pdfDoc.embedPng(externalQrBytes)
        
        const internalQrBytes = await fetch(internalQrUrl).then((res) => res.arrayBuffer())
        const internalQrImage = await pdfDoc.embedPng(internalQrBytes)
        
        const receiptQrBytes = await fetch(receiptQrUrl).then((res) => res.arrayBuffer())

        firstPage.drawImage(externalQrImage, {
            x: 6,
            y: 6-heightOffset,
            width: qrSize,
            height: qrSize,
        })

        console.log('i drawd the qr code too :]')


        const secondPage = pdfDoc.insertPage(1, [width, height])

        // secondPage.drawRectangle({
        //     x: 0,
        //     y: 0,
        //     width: width,
        //     height: height,
        //     borderWidth: 1,
        //     borderColor: grayscale(0)
        // })

        secondPage.drawImage(internalQrImage, {
            x: 6,
            y: height - qrSize - 6,
            width: qrSize,
            height: qrSize,
        })

        secondPage.drawText('<— scan this with your phone camera', {
            x: 16,
            y: height-12-qrSize,
            size: 20,
            font: helveticaFont,
            rotate: degrees(-90)
        })

        secondPage.drawText(receiverName, {
            x: 12 + qrSize,
            y: height-22,
            size: 10,
            font: helveticaFont
        })
        
        secondPage.drawText(scenarioName, {
            x: 12 + qrSize,
            y: height-34,
            size: 10,
            font: helveticaFont
        })

        secondPage.drawText(missionRecordId || '', {
            x: 12 + qrSize,
            y: height-46,
            size: 10,
            font: helveticaFont
        })

        console.log('i added a second page with a qr code on it')

        var newPdf = await pdfDoc.save()

        if (format == 'A4') {
            newPdf = await reformatToA4({
                missionRecordId,
                scenarioName,
                receiverName,
                missionNote,
                clubName,
                externalQrBytes,
                labels: newPdf,
                receiptQrBytes
            })
        }

        buffer = Buffer.from(newPdf)

        console.log('now i saved that pdf and turned it bac to a buffer')

        var form = new FormData()

        console.log('ok i made a buffer and a form')

        form.append('token', token)
        form.append('thread_ts', thread)
        form.append('channels', channel)
        form.append('filename', fileName)
        form.append('filetype', 'pdf')
        form.append('initial_comment', message)
        form.append('file', buffer, {
            filename: fileName+'.pdf'
        })

        console.log('yay everything is appended to the form! redy to send :))')

        const slackResponse = await fetch('https://slack.com/api/files.upload', {
            method: 'POST',
            body: form
        })

        const slackResponseBody = await slackResponse.json()

        if (slackResponse.error) {
            console.log('i submitted pdf 2 slack but i got error :(')
            console.log(slackResponse.error)
            res.send(slackResponse.error)
            return
        }

        console.log('i submitted pdf 2 slack and it is good so happy!!!!!')
        console.log(slackResponseBody)

        console.log('gona try to upload pdf to AWS S3 :o')

        const uploadParams = {
            Bucket: 'hackclub-shipping-labels',
            Key: missionRecordId+'.pdf',
            ACL: 'public-read',
            Body: buffer
        }

        const s3Response = await s3.upload(uploadParams).promise()
        
        if (s3Response.err) {
            console.log('uh oh s3 says very bad hapin :(');
            console.log(s3Response)
            return
        }

        console.log('s3 says upload suxes!!')
        console.log(s3Response)

        const zapResponse = await fetch('https://hooks.zapier.com/hooks/catch/507705/o47eshq/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pdfUrl: s3Response.Location,
                missionRecordId
            })
        })
        
        console.log('now i submitted the slcak pdf url to zaper!!! here is the zapier response:')
        // console.log(zapResponse)

        res.send({
            statusCode: zapResponse.statusCode,
            statusMessage: zapResponse.statusMessage,
            message: zapResponse.message,
            file: zapResponse.file,
        })
    // }
    // catch (err) {
    //     console.log('ummmmm something bad hapend :(((')
    //     console.log(err)
    //     res.send(err)
    // }
})