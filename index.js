const render = require('./render')

const FormData = require('form-data')
const express = require('express')
const pdflib = require('pdf-lib')
const fetch = require('node-fetch')
const AWS = require('aws-sdk')
const uuid = require('uuid')

AWS.config.update({region: 'us-west-2'})
s3 = new AWS.S3({apiVersion: '2006-03-01'});

const app = express()

app.use(express.json())

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running on port 3000");
});

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

async function reformatToA4(labels) {
    console.log('ok maam i will reformat these labels to fit the A4 sticky label sheets :)')

    const externalLabelImage = await render(labels, 1)
    const internalLabelImage = await render(labels, 2)

    console.log('i rendered the pages to images hoo-rah!!')

    const pdf = await pdflib.PDFDocument.create()
    const page = pdf.addPage()

    const externalLabelEmbedded = await pdf.embedPng(externalLabelImage)
    const internalLabelEmbedded = await pdf.embedPng(internalLabelImage)

    const ppi = 64

    page.drawImage(internalLabelEmbedded, {
        x: page.getWidth() / 2 + ppi*3,
        y: page.getHeight() / 2 - ppi*4.5,
        width: ppi*4,
        height: ppi*6,
        rotate: pdflib.degrees(90)
    })

    page.drawImage(externalLabelEmbedded, {
        x: page.getWidth() / 2 + ppi*3,
        y: page.getHeight() / 2 + ppi*0.5,
        width: ppi*4,
        height: ppi*6,
        rotate: pdflib.degrees(90)
    })

    console.log('now i drawd those imuges on a new pdf')

    var newPdf = await pdf.save()
    return newPdf
}

app.post('/shipping-label', async function (req, res) {
    console.log('oh boy oh boy here comes a request to prepare a shipping label!!')

    try {
        const {
            scenarioName,
            missionNote,
            fileData,
            fileName,
            message,
            thread,
            token,
            channel,
            internalQrUrl,
            externalQrUrl,
            missionRecordId,
            format
        } = req.body

        console.log(`hmmm, lots of stuff to unpack here for this ${scenarioName} shipment...`)

        var buffer = Buffer.from(fileData, 'base64')

        var pdfDoc = await pdflib.PDFDocument.load(buffer)
        var helveticaFont = await pdfDoc.embedFont(pdflib.StandardFonts.Helvetica)

        console.log('i loaded the documint from the base64 data suxesfuly')

        var pages = pdfDoc.getPages()
        var firstPage = pages[0]

        var { width, height } = firstPage.getSize()
        
        firstPage.drawText(scenarioName, {
            x: 10,
            y: 20,
            size: 10,
            font: helveticaFont
        })

        firstPage.drawText(missionNote || '', {
            x: 10,
            y: 10,
            size: 5,
            font: helveticaFont
        })

        console.log('i drawd the text to the first page')

        const internalQrBytes = await fetch(internalQrUrl).then((res) => res.arrayBuffer())
        const internalQrImage = await pdfDoc.embedPng(internalQrBytes)

        const secondPage = pdfDoc.insertPage(1, [width, height])

        const qrSize = 50

        secondPage.drawImage(internalQrImage, {
            x: secondPage.getWidth() / 2 - qrSize / 2,
            y: secondPage.getHeight() / 2 - qrSize / 2,
            width: qrSize,
            height: qrSize,
        })

        secondPage.drawText('Scan that code with your phone\'s camera app!', {
            x: 10,
            y: 10,
            size: 10,
            font: helveticaFont
        })

        console.log('i added a second page with a qr code on it')

        var newPdf = await pdfDoc.save()

        if (format == 'A4') {
            newPdf = await reformatToA4(newPdf)
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
    }
    catch (err) {
        console.log('ummmmm something bad hapend :(((')
        console.log(err)
        res.send(err)
    }
})