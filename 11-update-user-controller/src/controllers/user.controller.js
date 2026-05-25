import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { apiResponse } from "../utils/apiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshToken = async(userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })

        return { accessToken, refreshToken }
    } catch (error) {
        throw new apiError(500, "Something went wrong while generating access and refresh tokens")
    }
};

const registerUser = asyncHandler(async (req, res) => {
    // res.status(200).json({
    //     message: "ok"
    // });

    const { fullname, email, username, password } = req.body
    console.log("email ", email);
    
    // if (fullname === "") {
    //     throw new apiError(400, "fullname is required") 
    // }

    if (
        [fullname, email, username, password].some((field) => 
        field?.trim() === "")
    ) {
        throw new apiError(400, "All fields are required");
    }

    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    });

    const deleteLocalFile = (filePath) => {
    try {
        if (filePath) fs.unlinkSync(filePath);
    } catch (err) {
        console.log("File delete error:", err);
    }
};

    if (existedUser) {
        deleteLocalFile(req.files?.avatar?.[0]?.path);
        deleteLocalFile(req.files?.coverImage?.[0]?.path);

        throw new apiError(409, "User with email or username already exists!")
    }

    // console.log(req.files);
    

    const avatarLocalPath = req.files?.avatar?.[0]?.path;
    const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

    // console.log("avatarLocalPath:", avatarLocalPath);

    if (!avatarLocalPath) {
        throw new apiError(400, "Avatar file is required!")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    // console.log("avatar object:", avatar);


    if (!avatar) {
        throw new apiError(400, "Avatar file is required!");
    }

    const user = await User.create({
        fullname,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        username: username.toLowerCase(),
        password
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );

    if (!createdUser) {
        throw new apiError(500, "Something went wrong while registering user");
    }

    return res.status(201).json(
        new apiResponse(200, createdUser, "User Registered successfully")
    );
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, username, password } = req.body

    if (!username && !email) {
        throw new apiError(400, "username or email is required");
    }
    
    // if (!(username || email)) {  //alternative
    //     throw new apiError(400, "username or email is required");
    // }

    // if (!username || !email) {   //if require both
    //     throw new apiError(400, "username and email is required");
    // }


    const user =await User.findOne({
        $or: [{username}, {email}]
    });

    if (!user) {
        throw new apiError(400, "User does not exists");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);

    if (!isPasswordValid) {
        throw new apiError(401, "Invalid user credentials");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(new apiResponse(200,
        {
            user: loggedInUser, accessToken, refreshToken
        },
        "User logged in successfully" 
    ));
});

const logoutUser = asyncHandler(async (req, res) => {
    // remove cookies
    // reset refreshToken
    // create a middleware
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: { refreshToken: undefined }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res.status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new apiResponse(200, {}, "User logged out"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if (!incomingRefreshToken) {
        throw new apiError(401, "Unauthorized request");
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );
    
        const user = await User.findById(decodedToken?._id);
    
        if (!user) {
            throw new apiError(401, "Invalid Refresh Token");
        }
    
        if (incomingRefreshToken !== user?.refreshToken) {
            throw new apiError(401, "Refresh token is expired or used");
        }
    
        const options = {
            httpOnly: true,
            secure: true
        }
    
        const { accessToken, newRefreshToken } = await generateAccessAndRefreshToken(user._id);
    
        return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new apiResponse(
                200,
                {
                    accessToken, refreshToken: newRefreshToken
                },
                "Access token refreshed"
            )
        );
    } catch (error) {
        throw new apiError(401, error?.message || "Invalid refresh token");
    }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    const user = await User.findById(req.user?._id);

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

    if (!isPasswordCorrect) {
        throw new apiError(400, "Invalid old password")
    };

    user.password = newPassword;
    await user.save({validateBeforeSave: false});

    return res.status(200)
    .json(new apiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async(req, res) => {
    return res.status(200)
    .json(200, req.user, "Current user fetched successfully");
});

const updatedAccountDetails = asyncHandler(async (req, res) => {
    const { fullname, email } = req.body;

    if(!fullname || !email) {
        throw new apiError(400, "All fields are required");
    }

    const use = User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullname,
                email: email
            }
        },
        {new: true}
    ).select("-password")

    return res.status(200)
    .json(new apiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async(req, res) => {
    const avatarLocalPath =  req.file?.path

    if (!avatarLocalPath) {
        throw new apiError(400, "Avatar file is missing");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar.url) {
        throw new apiError(400, "Error while uploading on avatar");
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        {new: true}
    ).select("-password")

    return res.status(200)
    .json(new apiResponse(200), user, "Avatar updated successfully");
});

const updateUserCoverImage = asyncHandler(async(req, res) => {
    const coverImageLocalPath =  req.file?.path

    if (!coverImageLocalPath) {
        throw new apiError(400, "Cover image file is missing");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!coverImage.url) {
        throw new apiError(400, "Error while uploading on cover image");
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {new: true}
    ).select("-password")

    return res.status(200)
    .json(new apiResponse(200), user, "Cover image updated successfully");
});

export { registerUser, loginUser, logoutUser, refreshAccessToken, changeCurrentPassword, getCurrentUser, updatedAccountDetails, updateUserAvatar, updateUserCoverImage };










// steps
    // get user details from frontend
    // validation - not empty
    // check if user already exists: username, email
    // check for images, check for avatar
    // upload them to cloudinary, avatar
    // create user object - create entry in db
    // remove password and refresh token field from response
    // check for user creation
    // return response

// steps for login
    // req body -> data
    // username or email
    // find user
    // pass check
    // access and refresh token generate
    // send cookie